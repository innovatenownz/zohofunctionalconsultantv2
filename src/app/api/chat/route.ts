import { NextResponse } from 'next/server';
import { processConsultantRequestStream } from '@/lib/agents/business-analyst';
import { executeMCPCommand } from '@/lib/agents/mcp-agent';
import { listFolderFiles, extractDocumentText } from '@/lib/google-drive';
import { getProject, logActivity, updateProjectMemoryFromExecution } from '@/lib/project-service';
import { getSession } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

// Dynamically generate Google Application Credentials from Firebase Env Vars
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.FIREBASE_PRIVATE_KEY) {
  const tmpPath = path.join('/tmp', '.gcp-temp-key.json');
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
              const { listChats } = require('@/lib/project-service');
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
              } catch (e) {
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
                const successMsg = `\n\n**✅ MCP Command Executed Successfully:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
                sendEvent('content', { delta: successMsg });

                if (projectId) {
                  // Update the CRM memory spec based on execution success
                  await updateProjectMemoryFromExecution(projectId, commandJson.action, commandJson, true);
                  // Log successful execution
                  await logActivity(projectId, 'mcp_execution', `Executed ${commandJson.action} successfully`, { command: commandJson, result });
                }
              } catch (e: any) {
                const errorMsg = `\n\n**❌ Failed to execute MCP Command:** ${e.message}`;
                sendEvent('content', { delta: errorMsg });

                if (projectId) {
                  await logActivity(projectId, 'mcp_failure', `Failed to execute ${commandJson.action}`, { command: commandJson, error: e.message });
                }
              }
            } else {
              const warningMsg = `\n\n*(Note: MCP Command generated, but MCP server is not fully configured or enabled for this project)*`;
              sendEvent('content', { delta: warningMsg });
            }
          }

          // Generate summary in the background and update the chat session document
          if (projectId && chatId) {
            (async () => {
              try {
                const { generateChatSummary } = require('@/lib/agents/business-analyst');
                const { updateChat } = require('@/lib/project-service');
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
          sendEvent('content', { delta: `\n\n**Streaming Error:** ${error.message}` });
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
