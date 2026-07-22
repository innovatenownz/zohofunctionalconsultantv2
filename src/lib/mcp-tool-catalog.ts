/**
 * Compact MCP tool catalog + single-tool schema lookup helpers.
 * Used by list_tools / get_tool_schema meta-actions and by persistence/history caps.
 */

export const COMPACT_DESCRIPTION_MAX_CHARS = 120;

export const PERSISTED_RESULT_CAP_GENERIC = 2000;
export const PERSISTED_RESULT_CAP_LIST_TOOLS = 50_000;
export const PERSISTED_RESULT_CAP_GET_TOOL_SCHEMA = 16_000;

export const HISTORY_MSG_CAP_GENERIC = 3000;
export const HISTORY_MSG_CAP_LIST_TOOLS = 50_000;
export const HISTORY_MSG_CAP_GET_TOOL_SCHEMA = 16_000;

export type CompactMcpToolEntry = {
  name: string;
  description: string;
  serverName: string | null;
};

export type FullMcpToolListing = {
  name?: string;
  description?: string;
  serverName?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  [key: string]: unknown;
};

export type SchemaLookupSuccess = {
  tool: {
    name: string;
    description: string;
    serverName: string | null;
    inputSchema: unknown;
  };
};

export type SchemaLookupErrorCode =
  | 'SCHEMA_LOOKUP_INVALID'
  | 'SCHEMA_LOOKUP_NOT_FOUND'
  | 'SCHEMA_LOOKUP_AMBIGUOUS';

export type SchemaLookupError = {
  error: string;
  code: SchemaLookupErrorCode;
  matchingServerNames?: string[];
  isError: true;
};

/** Collapse whitespace and truncate to a one-line catalog description. */
export function toCompactToolDescription(
  description: string | undefined,
  maxChars: number = COMPACT_DESCRIPTION_MAX_CHARS
): string {
  if (!description) return '';
  const line = description.replace(/\s+/g, ' ').trim();
  if (line.length <= maxChars) return line;
  if (maxChars <= 1) return '…';
  return line.slice(0, maxChars - 1) + '…';
}

/** Map full MCP tool listings to compact catalog entries (no schemas/annotations). */
export function toCompactToolCatalog(tools: FullMcpToolListing[]): CompactMcpToolEntry[] {
  return tools.map((t) => ({
    name: typeof t.name === 'string' ? t.name : '',
    description: toCompactToolDescription(
      typeof t.description === 'string' ? t.description : undefined
    ),
    serverName: typeof t.serverName === 'string' ? t.serverName : null,
  }));
}

export function leanToolSchemaPayload(tool: FullMcpToolListing): SchemaLookupSuccess['tool'] {
  return {
    name: typeof tool.name === 'string' ? tool.name : '',
    description: typeof tool.description === 'string' ? tool.description : '',
    serverName: typeof tool.serverName === 'string' ? tool.serverName : null,
    inputSchema: tool.inputSchema ?? {},
  };
}

/**
 * Resolve a get_tool_schema request against a full tool listing.
 * Pure — does not call MCP.
 */
export function resolveToolSchemaLookup(
  tools: FullMcpToolListing[],
  toolName: unknown,
  serverName?: unknown
): SchemaLookupSuccess | SchemaLookupError {
  if (typeof toolName !== 'string' || !toolName.trim()) {
    return {
      error: 'Missing toolName',
      code: 'SCHEMA_LOOKUP_INVALID',
      isError: true,
    };
  }

  const wantedName = toolName.trim();
  const wantedServer =
    typeof serverName === 'string' && serverName.trim() ? serverName.trim() : null;

  let matches = tools.filter((t) => t.name === wantedName);
  if (wantedServer) {
    matches = matches.filter((t) => t.serverName === wantedServer);
  }

  if (matches.length === 0) {
    return {
      error: `Tool not found: ${wantedName}`,
      code: 'SCHEMA_LOOKUP_NOT_FOUND',
      matchingServerNames: [],
      isError: true,
    };
  }

  if (!wantedServer && matches.length > 1) {
    const matchingServerNames = [
      ...new Set(
        matches
          .map((t) => t.serverName)
          .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      ),
    ];
    return {
      error: `Tool ${wantedName} exists on multiple connections; specify serverName`,
      code: 'SCHEMA_LOOKUP_AMBIGUOUS',
      matchingServerNames,
      isError: true,
    };
  }

  return { tool: leanToolSchemaPayload(matches[0]) };
}

/** Persistence / stream-to-history cap for MCP result JSON by action. */
export function persistedResultCapForAction(action: string): number {
  if (action === 'list_tools') return PERSISTED_RESULT_CAP_LIST_TOOLS;
  if (action === 'get_tool_schema') return PERSISTED_RESULT_CAP_GET_TOOL_SCHEMA;
  return PERSISTED_RESULT_CAP_GENERIC;
}

/** History truncate cap when feeding prior messages to Gemini. */
export function historyMsgCapForContent(content: string): number {
  if (!content) return HISTORY_MSG_CAP_GENERIC;

  // Prefer detecting the mcp-command that produced this agent message.
  if (/```mcp-command\s*\n[\s\S]*?"action"\s*:\s*"list_tools"/i.test(content)) {
    return HISTORY_MSG_CAP_LIST_TOOLS;
  }
  if (/```mcp-command\s*\n[\s\S]*?"action"\s*:\s*"get_tool_schema"/i.test(content)) {
    return HISTORY_MSG_CAP_GET_TOOL_SCHEMA;
  }

  // Fallback: detect result envelopes if command fence was stripped.
  if (/"inputSchema"\s*:/.test(content) && /"tool"\s*:\s*\{/.test(content)) {
    return HISTORY_MSG_CAP_GET_TOOL_SCHEMA;
  }
  if (/"tools"\s*:\s*\[/.test(content) && !/"inputSchema"\s*:/.test(content)) {
    return HISTORY_MSG_CAP_LIST_TOOLS;
  }

  return HISTORY_MSG_CAP_GENERIC;
}

/** Truncation suffix for persisted MCP JSON (action-aware wording). */
export function truncatedPersistedResultSuffix(action: string, totalChars: number): string {
  if (action === 'get_tool_schema') {
    return (
      `\n...[truncated tool schema, ${totalChars} characters total — re-call get_tool_schema is not enough if truncated; ` +
      `prefer a smaller/related tool or ask the user for missing required fields. Full output is in Developer Details.]`
    );
  }
  return `\n...[truncated, ${totalChars} characters total — see Developer Details for full output]`;
}

/** Apply persistence cap to pretty-printed MCP result JSON. */
export function capPersistedResultJson(action: string, fullJson: string): string {
  const cap = persistedResultCapForAction(action);
  if (fullJson.length <= cap) return fullJson;
  return fullJson.slice(0, cap) + truncatedPersistedResultSuffix(action, fullJson.length);
}

/** Truncate a single history message for the Gemini prompt. */
export function truncateHistoryContent(content: string): string {
  const max = historyMsgCapForContent(content);
  if (!content || content.length <= max) return content;
  const keep = Math.floor(max / 2);
  return content.slice(0, keep) + '\n...[truncated]...\n' + content.slice(-keep);
}
