import { NextResponse } from 'next/server';
import { processConsultantRequestStream, generateChatSummary } from '@/lib/agents/business-analyst';
import { executeMCPCommand, McpError } from '@/lib/agents/mcp-agent';
import { listFolderFiles, extractDocumentText } from '@/lib/google-drive';
import { getProject, logActivity, updateProjectMemoryFromExecution, listChats, updateChat, appendChatMessages } from '@/lib/project-service';
import { getSession } from '@/lib/auth';
import fs from 'fs';
import os from 'os';
import path from 'path';

function getMcpUserMessage(error: unknown): string {
  if (!(error instanceof McpError)) {
    return 'Something went wrong while running that action. Please try again.';
  }

  switch (error.code) {
    case 'ZOHO_TOKEN_EXPIRED':
      return 'Your Zoho connection has expired. Please reconnect it in Settings & Context.';
    case 'ZOHO_UNREACHABLE':
      return "We couldn't reach your Zoho connection right now. Please try again shortly.";
    case 'ZOHO_NOT_CONFIGURED':
      return 'No Zoho connection is set up for this project. Go to Settings & Context to connect one.';
    case 'ZOHO_UNKNOWN':
    default:
      return 'Something went wrong while running that action. Please try again.';
  }
}

// Dynamically generate Google Application Credentials from Firebase Env Vars
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_PRIVATE_KEY) {
  const tmpPath = path.join(os.tmpdir(), '.gcp-temp-key.json');
  if (!fs.existsSync(tmpPath)) {
    fs.writeFileSync(tmpPath, JSON.stringify({
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL
    }));
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, projectId, mcpServers, driveFolderId, chatHistory, chatId, attachments } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }


    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
        };

        try {
          // Persist the incoming user message server-side (Admin SDK bypasses client rules)
          if (projectId && chatId) {
            const userMessageToStore: any = {
              role: 'user',
              content: message,
              timestamp: Date.now(),
              attachments: Array.isArray(attachments)
                ? attachments.map((a: any) => ({ name: a.name, size: a.size }))
                : [],
            };
            if (session?.user) {
              userMessageToStore.user = {
                name: session.user.name,
                email: session.user.email,
                image: session.user.image,
              };
            }
            await appendChatMessages(projectId, chatId, [userMessageToStore]);
          }

          let driveContext = '';

          // 1. Fetch Context from Google Drive if a folder is linked
          if (driveFolderId) {
            sendEvent('status', { message: 'Reading Google Drive documentation context...' });
            try {
              const files = await listFolderFiles(driveFolderId);
              const supportedFiles = files.filter(f => f.mimeType === 'application/vnd.google-apps.document' || f.mimeType === 'text/plain' || f.mimeType === 'text/markdown' || f.mimeType === 'application/vnd.google-apps.spreadsheet' || f.mimeType === 'text/csv' || f.mimeType === 'application/json');
              
              const extractedTexts = [];
              for (const doc of supportedFiles) {
                if (doc.id && doc.mimeType) {
                  try {
                    const text = (await extractDocumentText(doc.id, doc.mimeType)) as string;
                    extractedTexts.push(`--- Document: ${doc.name} ---\n${text.substring(0, 8000)}`); // limit context per document
                  } catch (err) {
                    console.warn(`Failed to read document ${doc.name}`, err);
                  }
                }
              }
              
              if (extractedTexts.length > 0) {
                driveContext = `[Google Drive Documentation Context]\n${extractedTexts.join('\n\n')}`;
              } else {
                driveContext = "[No readable documents found in the linked Google Drive folder]";
              }
            } catch (e) {
              console.error("Failed to fetch drive context. Continuing without it.", e);
              driveContext = "[Failed to load Drive Context due to permission or API error]";
            }
          }

          // Fetch project's dynamic requirements specification context & blueprint memory
          sendEvent('status', { message: 'Loading project specifications & roadmap...' });
          const project = projectId ? await getProject(projectId) : null;

          let additionalContext = '';
          if (projectId && chatId) {
            try {
              const chats = await listChats(projectId);
              const otherChats = chats.filter((c: any) => c.id !== chatId);
              if (otherChats.length > 0) {
                const summaries = otherChats.map((c: any) => {
                  const summaryText = c.summary || (c.messages && c.messages.length > 1
                    ? c.messages.slice(1, 4).map((m: any) => m.content.substring(0, 100)).join('; ')
                    : 'No messages');
                  return `- Chat Session Title: "${c.title}"\n  Summary of Context & Decisions: ${summaryText}`;
                }).join('\n\n');
                additionalContext = `\n\nPREVIOUS CHAT THREADS CONTEXT:\n${summaries}`;
              }
            } catch (e) {
              console.warn("Failed to get other chats' context:", e);
            }
          }

          const projectContext = project ? {
            overallRequirements: project.overallRequirements,
            crmRoadmap: project.crmRoadmap,
            projectContext: (project.projectContext || '') + additionalContext,
            plannedTools: project.plannedTools
          } : undefined;

          // Append client-side file attachments content to the prompt message
          let messageWithAttachments = message;
          if (attachments && Array.isArray(attachments) && attachments.length > 0) {
            messageWithAttachments += "\n\n[User Attached Files]";
            for (const file of attachments) {
              messageWithAttachments += `\n\n--- Attached File: ${file.name} ---\n${file.content}`;
            }
          }

          // 2. Call Business Analyst Agent Stream
          sendEvent('status', { message: 'Consultant agent is thinking...' });
          const responseStream = await processConsultantRequestStream(
            messageWithAttachments, 
            driveContext, 
            chatHistory || [],
            project?.memorySpec,
            projectContext
          );

          let finalResponseText = '';
          sendEvent('status', { message: 'Generating recommendations...' });
          for await (const chunk of responseStream) {
            const chunkText = chunk.text || '';
            finalResponseText += chunkText;
            sendEvent('content', { delta: chunkText });
          }
          let assistantContent = finalResponseText;

          // 3. Extract and Execute MCP Command (A2A handoff)
          const mcpCommandMatch = finalResponseText.match(/```mcp-command\n([\s\S]*?)```/);
          
          if (mcpCommandMatch) {
            const commandJson = JSON.parse(mcpCommandMatch[1]);
            
            // Filter config based on project's enabled server connections or fall back to DB
            let filteredMcpServers = mcpServers;
            if (!filteredMcpServers || Object.keys(filteredMcpServers).length === 0) {
              filteredMcpServers = project?.mcpConfig || project?.mcpServers || {};
            }
            if (typeof filteredMcpServers === 'string') {
              try {
                filteredMcpServers = JSON.parse(filteredMcpServers);
              } catch {
                filteredMcpServers = {};
              }
            }
            // Ensure it is a cloned object
            filteredMcpServers = JSON.parse(JSON.stringify(filteredMcpServers || {}));

            if (project?.enabledMcpServers && filteredMcpServers.mcpServers) {
              const filtered: Record<string, any> = {};
              for (const name of project.enabledMcpServers) {
                if (filteredMcpServers.mcpServers[name]) {
                  filtered[name] = filteredMcpServers.mcpServers[name];
                }
              }
              filteredMcpServers.mcpServers = filtered;
            }

            const hasMcpServers = filteredMcpServers && (
              (Array.isArray(filteredMcpServers) && filteredMcpServers.length > 0) || 
              (typeof filteredMcpServers === 'object' && !Array.isArray(filteredMcpServers) && Object.keys(filteredMcpServers).length > 0)
            );
            
            if (hasMcpServers) {
              const displayAction = commandJson.action.includes('_') ? commandJson.action.split('_')[0] + ': ' + commandJson.action.split('_').slice(1).join(' ') : commandJson.action;
              sendEvent('status', { message: `Executing MCP Command: ${displayAction}...` });
              try {
                // Send to MCP Agent Client
                const result = await executeMCPCommand(filteredMcpServers, commandJson, projectId);
                const fullJson = JSON.stringify(result, null, 2);
                // Stream the full JSON so the UI "Developer Details" panel still has the complete payload.
                const successMsg = `\n\n**✅ MCP Command Executed Successfully:**\n\`\`\`json\n${fullJson}\n\`\`\``;
                sendEvent('content', { delta: successMsg });
                // Persist/resent-to-Gemini copy is capped so large list_tools (etc.) results don't bloat every future turn.
                const MAX_PERSISTED_RESULT_CHARS = 2000;
                let persistedJson = fullJson;
                if (fullJson.length > MAX_PERSISTED_RESULT_CHARS) {
                  persistedJson =
                    fullJson.slice(0, MAX_PERSISTED_RESULT_CHARS) +
                    `\n...[truncated, ${fullJson.length} characters total — see Developer Details for full output]`;
                }
                const persistedSuccessMsg = `\n\n**✅ MCP Command Executed Successfully:**\n\`\`\`json\n${persistedJson}\n\`\`\``;
                assistantContent += persistedSuccessMsg;

                if (projectId) {
                  // Update the CRM memory spec based on execution success
                  await updateProjectMemoryFromExecution(projectId, commandJson.action, commandJson, true);
                  // Log successful execution
                  await logActivity(projectId, 'mcp_execution', `Executed ${commandJson.action} successfully`, { command: commandJson, result });
                }
              } catch (e: any) {
                console.error('MCP command execution failed:', e);
                const errorMsg = `\n\n**❌ Failed to execute MCP Command:** ${getMcpUserMessage(e)}`;
                sendEvent('content', { delta: errorMsg });
                assistantContent += errorMsg;

                if (projectId) {
                  await logActivity(projectId, 'mcp_failure', `Failed to execute ${commandJson.action}`, {
                    command: commandJson,
                    error: e instanceof Error ? e.message : 'Unknown MCP error',
                    code: e instanceof McpError ? e.code : 'ZOHO_UNKNOWN',
                  });
                }
              }
            } else {
              const warningMsg = `\n\n*(Note: MCP Command generated, but MCP server is not fully configured or enabled for this project)*`;
              sendEvent('content', { delta: warningMsg });
              assistantContent += warningMsg;
            }
          }

          // Persist the finalized agent message (server-side; includes any MCP result text shown to the user)
          if (projectId && chatId) {
            await appendChatMessages(projectId, chatId, [
              { role: 'agent', content: assistantContent, timestamp: Date.now() },
            ]);
          }

          // Generate summary in the background and update the chat session document
          if (projectId && chatId) {
            (async () => {
              try {
                const summary = await generateChatSummary(chatHistory || [], message, finalResponseText);
                if (summary) {
                  await updateChat(projectId, chatId, { summary });
                  console.log(`[Chat-Summary] Successfully updated chat ${chatId} summary: ${summary}`);
                }
              } catch (e) {
                console.error("Failed to update chat summary:", e);
              }
            })();
          }

          sendEvent('done', {});
          controller.close();
        } catch (error: any) {
          console.error('Streaming error inside controller:', error);
          sendEvent('content', { delta: '\n\n**Streaming Error:** Something went wrong while processing your request. Please try again.' });
          sendEvent('done', {});
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
