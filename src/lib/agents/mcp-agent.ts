import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerAuth } from '../mcp-auth-sync';

export type McpErrorCode =
  | 'ZOHO_TOKEN_EXPIRED'
  | 'ZOHO_UNREACHABLE'
  | 'ZOHO_NOT_CONFIGURED'
  | 'ZOHO_SERVER_NAME_INVALID'
  | 'ZOHO_UNKNOWN';

export class McpError extends Error {
  code: McpErrorCode;
  cause?: unknown;
  requestedServerName?: string;
  availableServerNames?: string[];

  constructor(
    code: McpErrorCode,
    message: string,
    cause?: unknown,
    context?: { requestedServerName?: string; availableServerNames?: string[] }
  ) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.cause = cause;
    this.requestedServerName = context?.requestedServerName;
    this.availableServerNames = context?.availableServerNames;
  }
}

function getErrorText(err: unknown): string {
  if (err == null) return '';
  const anyErr = err as Record<string, unknown>;
  return [
    anyErr.code,
    anyErr.status,
    anyErr.message,
    anyErr.body,
    (anyErr.response as Record<string, unknown> | undefined)?.body,
    String(err),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isUnauthorizedError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; status?: unknown; message?: unknown };
  return anyErr?.code === 401
    || anyErr?.status === 401
    || String(anyErr?.message || '').includes('401')
    || String(err || '').includes('401');
}

function isTokenExpiredError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; status?: unknown };
  if (anyErr?.status === 403 || anyErr?.code === 403) {
    return true;
  }
  if (isUnauthorizedError(err)) {
    return true;
  }

  const text = getErrorText(err);
  return text.includes('invalid_token')
    || text.includes('expired')
    || text.includes('unauthorized');
}

function isNetworkError(err: unknown): boolean {
  const text = getErrorText(err).toUpperCase();
  return text.includes('ECONNREFUSED')
    || text.includes('ETIMEDOUT')
    || text.includes('ENOTFOUND')
    || text.includes('ECONNRESET')
    || text.includes('EHOSTUNREACH')
    || text.includes('EAI_AGAIN')
    || text.includes('FETCH FAILED')
    || text.includes('NETWORK');
}

function classifyMcpError(err: unknown): McpError {
  if (err instanceof McpError) {
    return err;
  }

  if (isTokenExpiredError(err)) {
    return new McpError(
      'ZOHO_TOKEN_EXPIRED',
      'Zoho/MCP authentication token is expired or invalid.',
      err
    );
  }

  if (isNetworkError(err)) {
    return new McpError(
      'ZOHO_UNREACHABLE',
      'Zoho/MCP connection is unreachable.',
      err
    );
  }

  return new McpError(
    'ZOHO_UNKNOWN',
    'Unknown Zoho/MCP execution failure.',
    err
  );
}

function normaliseServerConfig(name: string, conf: any): any {
  const normalised = { name, ...conf };
  
  // Extract remote URL if it's passed inside arguments for mcp-remote
  if (!normalised.url && normalised.command === 'npx' && Array.isArray(normalised.args)) {
    const urlArg = normalised.args.find((arg: string) => 
      typeof arg === 'string' && (arg.startsWith('http://') || arg.startsWith('https://'))
    );
    if (urlArg) {
      normalised.url = urlArg;
    }
  }
  
  return normalised;
}

async function createTransportForServer(serverConfig: any) {
  // 1. Prefer HTTP/SSE Streamable Client for remote/hosted servers
  if (serverConfig.url) {
    const endpoint = new URL(serverConfig.url);
    const headers: Record<string, string> = {};
    if (serverConfig.token) {
      headers['Authorization'] = `Bearer ${serverConfig.token}`;
    }
    return new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } });
  }

  // 2. Fallback to local process execution only if it is a truly local stdio command
  if (serverConfig.command) {
    const isHosted = process.env.HOSTED === 'true' || process.env.NODE_ENV === 'production';
    if (isHosted) {
      throw new Error('Local stdio MCP servers are not supported in hosted deployments');
    }

    let command = serverConfig.command;
    let args = serverConfig.args || [];

    if (command === 'npx' && !args.includes('-y') && !args.includes('--yes')) {
      args = ['-y', ...args];
    }

    // Fix command resolution on Windows for npx and npm
    if (process.platform === 'win32') {
      if (command === 'npx') command = 'npx.cmd';
      if (command === 'npm') command = 'npm.cmd';
    }

    return new StdioClientTransport({
      command,
      args,
      env: serverConfig.env ? { ...process.env, ...serverConfig.env } : { ...process.env },
    });
  }

  throw new Error('Invalid MCP Server Configuration: must have either command or url');
}

/**
 * Load auth tokens for a server from Firestore (if projectId is available),
 * returning the updated serverConfig with the current access token.
 */
async function loadAuthForServer(server: any, projectId?: string): Promise<{ server: any; auth: McpServerAuth | null }> {
  if (!projectId || !server.name || !server.url) return { server, auth: null };

  try {
    const { getMcpAuthForServer } = await import('../mcp-auth-sync');
    const auth = await getMcpAuthForServer(projectId, server.name);
    if (auth) {
      return { server: { ...server, token: auth.accessToken || '' }, auth };
    }
  } catch (err) {
    console.error('[MCP-Auth] Failed to load auth from Firestore:', err);
  }
  return { server, auth: null };
}

/**
 * Refresh the access token and return the updated serverConfig.
 */
async function handleTokenRefresh(server: any, auth: McpServerAuth, projectId: string): Promise<any> {
  const { refreshAccessToken } = await import('../mcp-auth-sync');
  const newAuth = await refreshAccessToken(projectId, server.name, auth, server.url);
  return { ...server, token: newAuth.accessToken };
}

export async function listAllMCPTools(mcpServersConfig: any, projectId?: string) {
  let servers: any[] = [];
  if (Array.isArray(mcpServersConfig)) {
    servers = mcpServersConfig.map((conf: any, i: number) => normaliseServerConfig(conf.name || `server_${i}`, conf));
  } else if (mcpServersConfig?.mcpServers) {
    servers = Object.entries(mcpServersConfig.mcpServers).map(([name, conf]: [string, any]) => normaliseServerConfig(name, conf));
  } else if (mcpServersConfig?.url || mcpServersConfig?.command) {
    servers = [normaliseServerConfig(mcpServersConfig.name || 'default', mcpServersConfig)];
  }

  const allTools: any[] = [];

  for (const rawServer of servers) {
    let transport;
    try {
      // Load token from Firestore for URL-based servers
      const { server, auth } = await loadAuthForServer(rawServer, projectId);
      let activeServer = server;

      try {
        transport = await createTransportForServer(activeServer);
        const client = new Client({ name: 'zoho-consultant-agent', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
        const result = await client.listTools();
        if (result?.tools) {
          result.tools.forEach((tool: any) => {
            allTools.push({ ...tool, serverName: activeServer.name || 'default' });
          });
        }
        await transport.close();
      } catch (err: any) {
        // If 401 and we have a refresh token, retry once with a fresh access token
        const is401 = err?.code === 401 || err?.status === 401 || String(err?.message || '').includes('401') || String(err || '').includes('401');
        if (is401 && auth && projectId) {
          console.log(`[MCP-Auth] 401/Unauthorized for ${activeServer.name} — refreshing token and retrying...`);
          try {
            await transport?.close().catch(() => {});
            activeServer = await handleTokenRefresh(activeServer, auth, projectId);
            transport = await createTransportForServer(activeServer);
            const retryClient = new Client({ name: 'zoho-consultant-agent', version: '1.0.0' }, { capabilities: {} });
            await retryClient.connect(transport);
            const retryResult = await retryClient.listTools();
            if (retryResult?.tools) {
              retryResult.tools.forEach((tool: any) => {
                allTools.push({ ...tool, serverName: activeServer.name || 'default' });
              });
            }
            await transport.close();
          } catch (retryErr) {
            console.error(`[MCP-Auth] Retry after token refresh failed for ${activeServer.name}:`, retryErr);
          }
        } else {
          throw err;
        }
      }
    } catch (err) {
      console.error(`Failed to list tools for server ${rawServer.name || rawServer.url}:`, err);
      if (transport) { try { await transport.close(); } catch {} }
    }
  }

  return allTools;
}

export async function executeMCPCommand(mcpConfig: any, commandData: any, projectId?: string) {
  let servers: any[] = [];
  if (Array.isArray(mcpConfig)) {
    servers = mcpConfig.map((conf: any, i: number) => normaliseServerConfig(conf.name || `server_${i}`, conf));
  } else if (mcpConfig?.mcpServers) {
    servers = Object.entries(mcpConfig.mcpServers).map(([name, conf]: [string, any]) => normaliseServerConfig(name, conf));
  } else if (mcpConfig?.url || mcpConfig?.command) {
    servers = [normaliseServerConfig(mcpConfig.name || 'default', mcpConfig)];
  }

  if (servers.length === 0) {
    throw new McpError(
      'ZOHO_NOT_CONFIGURED',
      'No MCP Servers configured.'
    );
  }

  const toolName = commandData.action;

  if (toolName === 'list_tools') {
    return { tools: await listAllMCPTools(mcpConfig, projectId) };
  }

  // 1. Route by serverName if specified
  let targetServers = servers;
  if (commandData.serverName) {
    targetServers = servers.filter(s => s.name === commandData.serverName);
    if (targetServers.length === 0) {
      const requestedServerName = String(commandData.serverName);
      const availableServerNames = servers.map((s) => s.name);
      throw new McpError(
        'ZOHO_SERVER_NAME_INVALID',
        `Target MCP server "${requestedServerName}" is not configured or enabled. Available connections: ${availableServerNames.join(', ')}.`,
        undefined,
        { requestedServerName, availableServerNames }
      );
    }
  }

  // 2. Strip control fields from arguments
  let cleanArgs = {};
  if (commandData.arguments && typeof commandData.arguments === 'object') {
    cleanArgs = { ...commandData.arguments };
  } else {
    cleanArgs = { ...commandData };
    delete (cleanArgs as any).action;
    delete (cleanArgs as any).serverName;
    delete (cleanArgs as any).toolName;
  }

  let lastError: any = null;

  for (const rawServer of targetServers) {
    let transport;
    try {
      const { server, auth } = await loadAuthForServer(rawServer, projectId);
      let activeServer = server;

      try {
        transport = await createTransportForServer(activeServer);
        const client = new Client({ name: 'zoho-consultant-agent', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
        const result = await client.callTool({ name: toolName, arguments: cleanArgs });
        await transport.close();
        return result;
      } catch (err: any) {
        const is401 = isUnauthorizedError(err);
        if (is401 && auth && projectId) {
          console.log(`[MCP-Auth] 401/Unauthorized for ${activeServer.name} — refreshing token and retrying...`);
          try {
            await transport?.close().catch(() => {});
            activeServer = await handleTokenRefresh(activeServer, auth, projectId);
            transport = await createTransportForServer(activeServer);
            const retryClient = new Client({ name: 'zoho-consultant-agent', version: '1.0.0' }, { capabilities: {} });
            await retryClient.connect(transport);
            const retryResult = await retryClient.callTool({ name: toolName, arguments: commandData });
            await transport.close();
            return retryResult;
          } catch (retryErr: any) {
            const classified = classifyMcpError(retryErr);
            lastError = classified.code === 'ZOHO_UNREACHABLE'
              ? classified
              : new McpError(
                  'ZOHO_TOKEN_EXPIRED',
                  'Retry after token refresh failed.',
                  retryErr
                );
            console.error(`[MCP-Auth] Retry after token refresh failed for ${activeServer.name}:`, retryErr);
          }
        } else {
          throw classifyMcpError(err);
        }
      }
    } catch (error: any) {
      console.error(`Failed to execute tool ${toolName} on server ${rawServer.name || 'unknown'}:`, error);
      lastError = error instanceof McpError ? error : classifyMcpError(error);
      if (transport) { try { await transport.close(); } catch {} }
    }
  }

  throw lastError || new McpError(
    'ZOHO_UNKNOWN',
    `Failed to execute tool ${toolName} on any configured servers.`
  );
}
