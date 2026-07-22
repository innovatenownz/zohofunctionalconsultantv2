import { getMcpAuthForServer } from '@/lib/mcp-auth-sync';

const SENSITIVE_AUTH_FIELDS = new Set(['accessToken', 'refreshToken']);

/** Server names from mcpConfig in the same shapes mcp-agent accepts. */
export function getMcpServerNamesFromConfig(mcpServersConfig: unknown): string[] {
  if (!mcpServersConfig || typeof mcpServersConfig !== 'object') return [];

  if (Array.isArray(mcpServersConfig)) {
    return mcpServersConfig.map((conf, i) =>
      typeof conf === 'object' && conf && 'name' in conf
        ? String((conf as { name?: string }).name || `server_${i}`)
        : `server_${i}`
    );
  }

  const record = mcpServersConfig as Record<string, unknown>;
  if (
    record.mcpServers &&
    typeof record.mcpServers === 'object' &&
    !Array.isArray(record.mcpServers)
  ) {
    return Object.keys(record.mcpServers as object);
  }

  if (record.url || record.command) {
    return [typeof record.name === 'string' ? record.name : 'default'];
  }

  return [];
}

function serverConfigIsRunnable(name: string, mcpServersConfig: unknown): boolean {
  if (!mcpServersConfig || typeof mcpServersConfig !== 'object') return false;

  let entry: unknown;
  const record = mcpServersConfig as Record<string, unknown>;
  if (record.mcpServers && typeof record.mcpServers === 'object' && !Array.isArray(record.mcpServers)) {
    entry = (record.mcpServers as Record<string, unknown>)[name];
  } else if (record.url || record.command) {
    entry = record;
  }

  if (!entry || typeof entry !== 'object') return false;
  const conf = entry as Record<string, unknown>;
  return Boolean(conf.url || conf.command);
}

/**
 * Build a prompt line listing enabled MCP servers and whether each has stored OAuth credentials.
 * Uses live mcpCredentials lookups — not list_tools history.
 */
export async function buildConnectedMcpServersPromptLine(
  projectId: string,
  mcpServersConfig: unknown,
  enabledMcpServers?: string[] | null
): Promise<string | null> {
  const configuredNames = getMcpServerNamesFromConfig(mcpServersConfig);
  if (configuredNames.length === 0) return null;

  const names =
    Array.isArray(enabledMcpServers) && enabledMcpServers.length > 0
      ? enabledMcpServers.filter((n) => configuredNames.includes(n))
      : configuredNames;

  if (names.length === 0) return null;

  const parts: string[] = [];
  for (const name of names) {
    if (!serverConfigIsRunnable(name, mcpServersConfig)) {
      parts.push(`"${name}" (NOT CONNECTED — invalid or incomplete server configuration)`);
      continue;
    }

    const auth = await getMcpAuthForServer(projectId, name);
    const hasCredentials =
      Boolean(auth?.accessToken) &&
      Boolean(auth?.refreshToken) &&
      Boolean(auth?.clientId) &&
      Boolean(auth?.tokenEndpoint);

    if (hasCredentials) {
      parts.push(`"${name}" (authenticated)`);
    } else {
      parts.push(`"${name}" (NOT CONNECTED — missing credentials)`);
    }
  }

  return `CONNECTED MCP SERVERS FOR THIS PROJECT: ${parts.join(', ')}. Use ONLY these exact connection names as "serverName" when calling MCP tools.`;
}

export { SENSITIVE_AUTH_FIELDS };
