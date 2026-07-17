import { NextResponse } from 'next/server';
import { getProject, updateProject, logActivity } from '@/lib/project-service';
import { saveMcpAuthForServer, refreshAccessToken, discoverTokenEndpoint } from '@/lib/mcp-auth-sync';
import { getAdminDb } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { isSafeUrl } from '@/lib/url-helper';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const { serverName, serverUrl, credentialsJson } = await req.json();

    if (!serverName || !credentialsJson) {
      return NextResponse.json({ error: 'Missing serverName or credentialsJson' }, { status: 400 });
    }

    if (serverUrl) {
      if (!(await isSafeUrl(serverUrl))) {
        return NextResponse.json({ error: 'Unsafe or invalid serverUrl provided' }, { status: 400 });
      }
    }

    // Verify project exists
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 1. Parse and validate JSON credentials
    let parsed: any;
    try {
      parsed = JSON.parse(credentialsJson);
    } catch (err) {
      return NextResponse.json({ error: 'Credentials payload is not valid JSON' }, { status: 400 });
    }

    // Normalize parameters mapping snake_case, camelCase, spaces, and hyphens
    const clientId = parsed.clientId || parsed.client_id || parsed.clientid || parsed['client token'] || parsed['client-id'] || parsed['client id'];
    const refreshToken = parsed.refreshToken || parsed.refresh_token || parsed.refreshtoken || parsed['refresh token'] || parsed['refresh-token'];
    let tokenEndpoint = parsed.tokenEndpoint || parsed.token_endpoint || parsed.tokenendpoint || parsed['token endpoint'] || parsed['token-endpoint'];
    const scope = parsed.scope;
    const accessToken = parsed.accessToken || parsed.access_token || parsed.accesstoken || '';

    if (!clientId) {
      return NextResponse.json({ error: 'Missing client_id/clientId in the credentials JSON' }, { status: 400 });
    }
    if (!refreshToken) {
      return NextResponse.json({ error: 'Missing refresh_token/refreshToken in the credentials JSON' }, { status: 400 });
    }

    if (tokenEndpoint) {
      if (!(await isSafeUrl(tokenEndpoint))) {
        return NextResponse.json({ error: 'Unsafe or invalid tokenEndpoint in credentials JSON' }, { status: 400 });
      }
    }

    // 2. Discover token endpoint if not explicitly provided
    if (!tokenEndpoint && serverUrl) {
      console.log(`[MCP-Credentials] Discovering token endpoint from ${serverUrl}`);
      try {
        const discovered = await discoverTokenEndpoint(serverUrl);
        if (discovered) {
          if (!(await isSafeUrl(discovered))) {
            return NextResponse.json({ error: 'Discovered token endpoint is unsafe or invalid' }, { status: 400 });
          }
          tokenEndpoint = discovered;
        }
      } catch (discErr) {
        console.warn('[MCP-Credentials] Failed to discover token endpoint from URL:', discErr);
      }
    }


    if (!tokenEndpoint) {
      return NextResponse.json({ 
        error: 'Missing token_endpoint/tokenEndpoint in JSON, and discovery from SSE URL failed. Please provide token_endpoint explicitly.' 
      }, { status: 400 });
    }

    const authData = {
      accessToken,
      refreshToken,
      clientId,
      tokenEndpoint,
      scope: scope || '',
    };

    // 3. Temporarily save to Firestore so refreshAccessToken can use it for verification
    await saveMcpAuthForServer(projectId, serverName, authData);

    // 4. Verify by performing an immediate refresh check
    try {
      console.log(`[MCP-Credentials] Verifying manual credentials via instant refresh for ${serverName}`);
      await refreshAccessToken(projectId, serverName, authData, serverUrl);
    } catch (err: any) {
      console.error('[MCP-Credentials] Verification failed:', err.message);
      // Clean up the invalid credentials we just saved to keep Firestore clean
      const db = getAdminDb();
      if (db) {
        await db.collection('projects').doc(projectId).collection('mcpCredentials').doc(serverName).delete().catch(() => {});
      }
      return NextResponse.json({ 
        error: `Authentication verification failed: ${err.message}. Please check if the client_id, refresh_token, or token_endpoint are correct.` 
      }, { status: 400 });
    }

    // 5. Update project mcpConfig & enable the server
    const mcpConfig = project.mcpConfig || { mcpServers: {} };
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    
    if (serverUrl) {
      mcpConfig.mcpServers[serverName] = { url: serverUrl };
    }

    const enabledMcpServers = project.enabledMcpServers || [];
    if (!enabledMcpServers.includes(serverName)) {
      enabledMcpServers.push(serverName);
    }

    await updateProject(projectId, { mcpConfig, enabledMcpServers });

    // 6. Log activity
    await logActivity(
      projectId,
      'settings_update',
      `MCP Server "${serverName}" credentials uploaded manually and verified successfully.`,
      { serverName, serverUrl }
    );

    return NextResponse.json({ success: true, serverName });
  } catch (error: any) {
    console.error('API POST Credentials Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const { serverName } = await req.json();

    if (!serverName) {
      return NextResponse.json({ error: 'Missing serverName' }, { status: 400 });
    }

    // Verify project exists
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const db = getAdminDb();
    if (db) {
      await db.collection('projects').doc(projectId).collection('mcpCredentials').doc(serverName).delete();
    }

    // Clean up project's mcpConfig
    const mcpConfig = project.mcpConfig || { mcpServers: {} };
    if (mcpConfig.mcpServers && mcpConfig.mcpServers[serverName]) {
      delete mcpConfig.mcpServers[serverName];
    }
    
    // Clean up enabled server list
    const enabledMcpServers = (project.enabledMcpServers || []).filter(s => s !== serverName);

    await updateProject(projectId, { mcpConfig, enabledMcpServers });

    await logActivity(
      projectId,
      'settings_update',
      `MCP Server "${serverName}" configuration and credentials deleted by ${session?.user?.name || 'System User'}`,
      { serverName }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API DELETE Credentials Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
