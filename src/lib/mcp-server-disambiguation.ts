import { listAllMCPTools } from '@/lib/agents/mcp-agent';

export type McpToolListing = {
  name?: string;
  serverName?: string;
};

export type McpCommandExecutionDecision =
  | { execute: true; command: Record<string, unknown> }
  | { execute: false; disambiguationMessage: string };

type ListAllMcpToolsFn = typeof listAllMCPTools;

/** Count enabled/configured MCP servers in the same shapes mcp-agent accepts. */
export function countConfiguredMcpServers(mcpServersConfig: unknown): number {
  if (Array.isArray(mcpServersConfig)) {
    return mcpServersConfig.length;
  }

  if (mcpServersConfig && typeof mcpServersConfig === 'object') {
    const record = mcpServersConfig as Record<string, unknown>;
    if (
      record.mcpServers &&
      typeof record.mcpServers === 'object' &&
      !Array.isArray(record.mcpServers)
    ) {
      return Object.keys(record.mcpServers as object).length;
    }
    if (record.url || record.command) {
      return 1;
    }
  }

  return 0;
}

/** Distinct serverName values that expose a tool with the given action name. */
export function getMatchingServerNames(tools: McpToolListing[], action: string): string[] {
  const names = new Set<string>();
  for (const tool of tools) {
    if (tool.name === action && typeof tool.serverName === 'string' && tool.serverName.trim()) {
      names.add(tool.serverName.trim());
    }
  }
  return [...names];
}

export function buildDisambiguationMessage(action: string, serverNames: string[]): string {
  const formatted = serverNames.map((name) => `**${name}**`).join(', ');
  return `\n\n**Which MCP connection should I use?** The tool \`${action}\` is available on: ${formatted}. Reply with the exact connection name. This command has **not been executed yet**.`;
}

/** Merge serverName onto a command without dropping other tool arguments. */
export function withServerName(
  command: Record<string, unknown>,
  serverName: string
): Record<string, unknown> {
  return { ...command, serverName };
}

/**
 * Decide whether to execute an MCP command now or ask the user to pick a server.
 * Skips listAllMCPTools when only one server is configured (no ambiguity possible).
 */
export async function evaluateMcpCommandBeforeExecute(
  mcpServersConfig: unknown,
  commandJson: Record<string, unknown>,
  projectId: string | undefined,
  listTools: ListAllMcpToolsFn = listAllMCPTools
): Promise<McpCommandExecutionDecision> {
  const action = commandJson.action;
  if (typeof action !== 'string' || !action.trim()) {
    return { execute: true, command: commandJson };
  }

  if (action === 'list_tools' || action === 'get_tool_schema') {
    return { execute: true, command: commandJson };
  }

  if (typeof commandJson.serverName === 'string' && commandJson.serverName.trim()) {
    return { execute: true, command: commandJson };
  }

  if (countConfiguredMcpServers(mcpServersConfig) <= 1) {
    return { execute: true, command: commandJson };
  }

  const tools = await listTools(mcpServersConfig, projectId);
  const matchingServers = getMatchingServerNames(tools, action);

  if (matchingServers.length <= 1) {
    if (matchingServers.length === 1) {
      return { execute: true, command: withServerName(commandJson, matchingServers[0]) };
    }
    return { execute: true, command: commandJson };
  }

  return {
    execute: false,
    disambiguationMessage: buildDisambiguationMessage(action, matchingServers),
  };
}
