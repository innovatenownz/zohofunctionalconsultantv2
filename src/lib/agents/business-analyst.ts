import { GoogleGenAI } from '@google/genai';
import { truncateHistoryContent } from '@/lib/mcp-tool-catalog';

// Lazy-initialize the client so it runs AFTER GOOGLE_APPLICATION_CREDENTIALS
// has been set up by the API route handler.
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    // Force delete the API key so the SDK doesn't try to use it for Vertex AI
    delete process.env.GOOGLE_API_KEY;

    // The SDK reads project and location from these env vars when vertexai is true
    process.env.GOOGLE_CLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';

    _ai = new GoogleGenAI({ 
      vertexai: true
    });
  }
  return _ai;
}

function prepareAgentPrompt(
  userPrompt: string, 
  driveContext: string,
  chatHistory: Array<{role: string, content: string}> = [],
  memorySpec?: any,
  projectContext?: {
    overallRequirements?: string;
    crmRoadmap?: string;
    projectContext?: string;
    plannedTools?: string;
  },
  mcpConnectionContext?: string
) {
  let memoryPrompt = '';
  if (memorySpec && Array.isArray(memorySpec.activeModules) && memorySpec.activeModules.length > 0) {
    memoryPrompt = `
CURRENT CRM MEMORY BLUEPRINT (What has already been configured in this project):
${memorySpec.activeModules.filter(Boolean).map((mod: any) => {
  const fieldsStr = Array.isArray(mod.fields)
    ? mod.fields.filter(Boolean).map((f: any) => (typeof f === 'object' && f !== null) ? `${f.name || f.api_name || 'unnamed'} (${f.type || f.data_type || 'text'})` : f).join(', ')
    : 'None';
  const automationsStr = Array.isArray(mod.automations)
    ? mod.automations.filter(Boolean).map((a: any) => (typeof a === 'object' && a !== null) ? `${a.name || 'unnamed'} (Trigger: ${a.trigger || 'unknown'}, Action: ${a.action || 'unknown'})` : a).join(', ')
    : 'None';
  return `- Module: ${mod.name || 'Unnamed Module'}
    Fields: ${fieldsStr}
    Automations: ${automationsStr}`;
}).join('\n')}
`;
  }

  let systemInstruction = `
      You are the "Zoho Suite & Integration Consultant Agent", an expert Business Analyst.
      Your job is to help the user with their stated request for this chat — proposing and executing the modules, fields, workflows, and automations they asked for in Zoho products (such as CRM, Books, etc.) or external applications. Google Drive documentation may be provided as background reference only.

      TASK FOCUS (HIGHEST PRIORITY):
      - The most recently stated explicit user goal in THIS chat is authoritative. Stay on that goal until the user clearly changes it.
      - Treat Google Drive documents, project roadmap text, and other chat-thread summaries as BACKGROUND REFERENCE only. They must never silently override or replace the user's current request.
      - A vague follow-up such as "continue", "proceed", "keep going", or "next" means: continue the unfinished work from the most recent explicit goal in this chat — NOT "pick a new task from the Drive docs."
      - If you are unsure whether "continue" (or similar) still refers to the current task vs. something else, ASK the user for clarification. Do not guess and switch direction.
      - If you ever change what you are working on away from what the user most recently asked, you MUST say so explicitly in your response (e.g. "I'm switching to X because Y"). Never switch tasks silently.

      NOTE: Any relevant Google Drive documentation is automatically fetched by the system and provided to you directly in the prompt context. Do NOT attempt to use MCP tools to connect to Google Drive or read documents yourself, as you do not have tools for that.
      
      You have access to MCP Servers that interface with Zoho products and other external applications. 
      You communicate with them by outputting a JSON block wrapped in \`\`\`mcp-command
      tags.

      CRITICAL: You do NOT know the available tools on the MCP server in advance.
      Discover tools in two steps:

      1) Compact catalog — call list_tools first when you need to find which tools exist:
      
      \`\`\`mcp-command
      {
        "action": "list_tools"
      }
      \`\`\`
      
      The result is a compact catalog only: each entry has "name", a short "description", and "serverName".
      It does NOT include full argument schemas.

      2) Full schema — BEFORE you construct arguments for any tool call, if you do not already
      have that tool's full inputSchema from earlier in THIS conversation, call get_tool_schema:
      
      \`\`\`mcp-command
      {
        "action": "get_tool_schema",
        "toolName": "<exact_tool_name_from_list_tools>",
        "serverName": "<exact_connection_name>"
      }
      \`\`\`
      
      Wait for the schema result. Then build your real tool call to match inputSchema exactly.

      DO NOT invent tool names. ONLY use names returned by list_tools (or already confirmed in this chat).

      How to read a schema:
      - Mirror the nesting in inputSchema.properties. Zoho tools commonly nest under "body",
        "query_params", and/or "path_variables" — not flat top-level args.
      - Honor every key listed in each object's "required" array.
      - ALSO read each property's "description" text carefully. Some fields are mandatory in prose
        even when they are omitted from the formal "required" array (example: "profiles" on
        ZohoCRM_createModules for org_based modules). Treat such description requirements as mandatory.

      Example of a correctly nested tool call (after you have fetched the schema):
      \`\`\`mcp-command
      {
        "action": "ZohoCRM_createModules",
        "serverName": "Innovate Now CRM",
        "body": {
          "modules": [
            {
              "api_name": "Example_Module",
              "singular_label": "Example Module",
              "plural_label": "Example Modules",
              "profiles": [{ "id": "<profile_id_from_getProfiles>" }]
            }
          ]
        }
      }
      \`\`\`

      Wrong (do not do this — flat/guessed args that ignore inputSchema):
      \`\`\`mcp-command
      {
        "action": "ZohoCRM_createModules",
        "modules": [{ "api_name": "Example_Module", "display_label": "Example" }]
      }
      \`\`\`

      Include "serverName" when you know which connection to use (required after the user answers a connection-choice question).

      MULTIPLE MCP CONNECTIONS (SERVER DISAMBIGUATION):

      Some projects have more than one MCP server connection enabled. The same tool name may exist on more than one connection (each listed with a "serverName" in list_tools).

      When calling a tool, you MAY include "serverName" in your mcp-command to target one connection explicitly:

      \`\`\`mcp-command
      {
        "action": "<tool_name>",
        "serverName": "<exact_connection_name_from_list_tools>",
        ...other tool arguments...
      }
      \`\`\`

      If the system appends a message like "Which MCP connection should I use?" listing connection names, that means your previous command was NOT executed yet.

      When the user replies to that question:
      1. Treat their reply as choosing which connection to use (not as a brand-new task), unless they clearly change topic.
      2. Use ONLY a serverName from the list the system gave. Server names are case-sensitive and must match exactly (e.g. "server-a" is not the same as "Server-A").
      3. If the reply is unclear, ambiguous, or does not match any offered name, ask again and list the valid options. Do NOT guess or fuzzy-match.
      4. Re-issue the SAME tool call as before (same "action" and same arguments), adding "serverName" with the chosen name. Output a new mcp-command block and STOP.

      Do NOT call list_tools again just to disambiguate if you already have the tool name and arguments from the previous turn.
      Do NOT call get_tool_schema again for the same tool if its full inputSchema is already present earlier in THIS conversation.
      
      CRITICAL INSTRUCTION REGARDING COMMAND EXECUTION:
      When you generate an \`\`\`mcp-command\`\`\` block, you MUST STOP GENERATING IMMEDIATELY after the closing fence.
      DO NOT predict, hallucinate, or fake the execution result. DO NOT output "**✅ MCP Command Executed Successfully:**",
      "**❌ MCP Command Failed:**", sample JSON, profile/module/field IDs, success/failure claims, or any assumed outcome
      after (or instead of waiting for) your command. The backend executes the command and appends the REAL result to
      your message; only that appended result is authoritative.

      NO FABRICATED RESULTS OR IDs:
      - NEVER state or imply a specific result, ID, code, status, or outcome value in your own narrative text unless
        that exact value has already been returned by a real tool call earlier in THIS conversation (including a
        backend-appended "**✅ MCP Command Executed Successfully:**" / "**❌ MCP Command Failed:**" block).
      - Before a tool has returned, use only neutral intent language (e.g. "Let me check the profiles",
        "I'll look up the createModules schema next"). Do NOT invent example-looking IDs from training data,
        documentation samples, or schema illustrations.
      - After a real tool result is present, use ONLY values from that real result for any follow-up tool call.
        If your earlier narrative mentioned different IDs or outcomes that did NOT come from a tool result, discard
        them entirely — do not mix invented values with real ones. When multiple success-looking JSON blocks appear
        for the same call, prefer the backend-appended result (typically the later block that includes tool
        "content" / "structuredContent") over any earlier narrative you may have written.

      PREVIOUS CHATS MEMORY:
      You have access to the context and summaries of PREVIOUS chat sessions in this project under the section "PREVIOUS CHAT THREADS CONTEXT" below.
      If the user asks about previous chats, what was done in them, or to continue a request from a previous chat, refer to that context. You do indeed have memory of previous conversations via these summaries. Acknowledge this context and use it to answer the user's questions or continue their work.
    `;

  if (projectContext) {
    systemInstruction += `

CURRENT PROJECT REQUIREMENTS & ROADMAP:
- Project Context Area: ${projectContext.projectContext || 'None'}
- Overall Context: ${projectContext.overallRequirements || 'None'}
- Evolving Product & Integration Roadmap: ${projectContext.crmRoadmap || 'None'}
- Technical Methods Plan: ${projectContext.plannedTools || 'None'}
`;
  }

  if (mcpConnectionContext) {
    systemInstruction += `\n\n${mcpConnectionContext}\n`;
  }

  if (memoryPrompt) {
    systemInstruction += `\n\n${memoryPrompt}\n\nIMPORTANT: Use this Blueprint memory to understand what is already configured. Do not re-create fields or modules that already exist, unless explicitly asked to modify or delete them. Work incrementally.`;
  }

  // Construct the full prompt combining user input and fetched context.
  // Put the client's request FIRST so large Drive corpora cannot visually/structurally
  // dominate a short follow-up like "continue". Drive is labeled as background only.
  let fullPromptText = userPrompt;
  if (driveContext) {
    fullPromptText = `
Client Request (authoritative — stay on this goal unless the user clearly changes it):
${userPrompt}

Background reference only — Google Drive documentation (do NOT switch tasks to match these docs unless the Client Request above explicitly asks you to):
---
${driveContext}
---
    `;
  }

  // Map history to Gemini format (user/model)
  // Filter out the initial greeting from the agent to avoid API errors if the first message must be user
  // Cap each historical message with action-aware limits so compact list_tools / get_tool_schema
  // survive, while oversized generic tool results still cannot blow the context window.
  const formattedHistory = chatHistory
    .filter((msg, idx) => !(idx === 0 && msg.role === 'agent'))
    .map((msg) => ({
      role: msg.role === 'agent' ? 'model' : 'user',
      parts: [{ text: truncateHistoryContent(msg.content) }]
    }));

  return {
    systemInstruction,
    contents: [
      ...formattedHistory,
      {
        role: 'user',
        parts: [{ text: fullPromptText }]
      }
    ]
  };
}

export async function processConsultantRequest(
  userPrompt: string, 
  driveContext: string,
  chatHistory: Array<{role: string, content: string}> = [],
  memorySpec?: any,
  projectContext?: {
    overallRequirements?: string;
    crmRoadmap?: string;
    projectContext?: string;
    plannedTools?: string;
  },
  mcpConnectionContext?: string
) {
  try {
    const { systemInstruction, contents } = prepareAgentPrompt(
      userPrompt, 
      driveContext, 
      chatHistory, 
      memorySpec, 
      projectContext,
      mcpConnectionContext
    );

    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-pro',
      contents,
      config: {
        systemInstruction,
        temperature: 0.2,
      }
    });

    return response.text;
  } catch (error) {
    console.error('Error in Business Analyst Agent:', error);
    throw error;
  }
}

export async function processConsultantRequestStream(
  userPrompt: string, 
  driveContext: string,
  chatHistory: Array<{role: string, content: string}> = [],
  memorySpec?: any,
  projectContext?: {
    overallRequirements?: string;
    crmRoadmap?: string;
    projectContext?: string;
    plannedTools?: string;
  },
  mcpConnectionContext?: string
) {
  try {
    const { systemInstruction, contents } = prepareAgentPrompt(
      userPrompt, 
      driveContext, 
      chatHistory, 
      memorySpec, 
      projectContext,
      mcpConnectionContext
    );

    return await getAI().models.generateContentStream({
      model: 'gemini-2.5-pro',
      contents,
      config: {
        systemInstruction,
        temperature: 0.2,
      }
    });
  } catch (error) {
    console.error('Error in Business Analyst Agent (Stream):', error);
    throw error;
  }
}

/**
 * Generates a brief, 2-3 sentence summary of the current conversation thread.
 */
export async function generateChatSummary(
  history: Array<{role: string, content: string}> = [],
  latestUserMsg: string,
  latestAgentMsg: string
): Promise<string> {
  try {
    const messagesText = [
      ...history.map(m => `${m.role === 'agent' ? 'Agent' : 'User'}: ${m.content}`),
      `User: ${latestUserMsg}`,
      `Agent: ${latestAgentMsg}`
    ].join('\n');

    const prompt = `
Please read the following conversation thread between a User and a Zoho Consultant Agent.
Write a concise, comprehensive summary (2 to 3 sentences maximum) highlighting:
1. The main objectives and requirements discussed.
2. Any Zoho modules, fields, workflows, or integrations agreed upon or configured.
3. The current status or next steps.

Do not include any greeting or conversational filler. Return only the summary text.

Conversation Thread:
${messagesText}
`;

    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
      }
    });

    return response.text?.trim() || '';
  } catch (error) {
    console.error('Failed to generate chat summary:', error);
    return '';
  }
}

