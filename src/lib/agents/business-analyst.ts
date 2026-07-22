import { GoogleGenAI } from '@google/genai';

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
  }
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
      Your job is to analyze client requirements and Google Drive documentation (data dictionaries, meeting notes),
      and determine exactly what modules, fields, workflows, and automations need to be created or integrated in Zoho products (such as CRM, Books, etc.) or external applications.
      
      NOTE: Any relevant Google Drive documentation is automatically fetched by the system and provided to you directly in the prompt context. Do NOT attempt to use MCP tools to connect to Google Drive or read documents yourself, as you do not have tools for that.
      
      You have access to MCP Servers that interface with Zoho products and other external applications. 
      You communicate with them by outputting a JSON block wrapped in \`\`\`mcp-command
      tags.

      CRITICAL: You do NOT know the available tools on the MCP server in advance.
      If you need to interact with Zoho or test the connection, you MUST FIRST use the "list_tools" action:
      
      \`\`\`mcp-command
      {
        "action": "list_tools"
      }
      \`\`\`
      
      Wait for the system to return the list of tools. Then, ONLY use the actions (tool names) provided in that list.
      DO NOT invent tool names like "authenticate" or "create_module" unless you see them in the "list_tools" output.
      
      When you want to call a tool you discovered, provide its name as the "action" and include its arguments.
      
      Example:
      \`\`\`mcp-command
      {
        "action": "<tool_name_from_list_tools>",
        "arg1": "value1",
        "arg2": "value2"
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
      2. Use ONLY a serverName from the list the system gave. Server names are case-sensitive and must match exactly (e.g. "zohocrm" is not the same as "ZohoCRM").
      3. If the reply is unclear, ambiguous, or does not match any offered name, ask again and list the valid options. Do NOT guess or fuzzy-match.
      4. Re-issue the SAME tool call as before (same "action" and same arguments), adding "serverName" with the chosen name. Output a new mcp-command block and STOP.

      Do NOT call list_tools again just to disambiguate if you already have the tool name and arguments from the previous turn.
      
      CRITICAL INSTRUCTION REGARDING COMMAND EXECUTION:
      When you generate an \`\`\`mcp-command\`\`\` block, you MUST STOP GENERATING IMMEDIATELY.
      DO NOT predict, hallucinate, or fake the execution result. DO NOT output "**✅ MCP Command Executed Successfully:**" or any JSON response following your command. The backend system will execute your command and append the real result to your message on the next turn. If you fake the response, you will cause errors in the system because you will be hallucinating success when the actual command might have failed.

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

  if (memoryPrompt) {
    systemInstruction += `\n\n${memoryPrompt}\n\nIMPORTANT: Use this Blueprint memory to understand what is already configured. Do not re-create fields or modules that already exist, unless explicitly asked to modify or delete them. Work incrementally.`;
  }

  // Construct the full prompt combining user input and fetched context
  let fullPromptText = userPrompt;
  if (driveContext) {
    fullPromptText = `
    Based on the following documentation retrieved from Google Drive:
    ---
    ${driveContext}
    ---
    
    Client Request:
    ${userPrompt}
    `;
  }

  // Map history to Gemini format (user/model)
  // Filter out the initial greeting from the agent to avoid API errors if the first message must be user
  // Cap each historical message so oversized prior tool results (including ones saved before persistence capping) cannot blow the context window.
  const MAX_HISTORY_MSG_CHARS = 3000;
  const truncateHistoryContent = (content: string): string => {
    if (!content || content.length <= MAX_HISTORY_MSG_CHARS) return content;
    const keep = Math.floor(MAX_HISTORY_MSG_CHARS / 2);
    return content.slice(0, keep) + '\n...[truncated]...\n' + content.slice(-keep);
  };
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
  }
) {
  try {
    const { systemInstruction, contents } = prepareAgentPrompt(
      userPrompt, 
      driveContext, 
      chatHistory, 
      memorySpec, 
      projectContext
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
  }
) {
  try {
    const { systemInstruction, contents } = prepareAgentPrompt(
      userPrompt, 
      driveContext, 
      chatHistory, 
      memorySpec, 
      projectContext
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

