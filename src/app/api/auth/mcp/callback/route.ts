import { NextResponse } from 'next/server';
import { getProject, updateProject, logActivity } from '@/lib/project-service';
import { saveMcpAuthForServer } from '@/lib/mcp-auth-sync';
import { getAdminDb } from '@/lib/firebase-admin';
import { safeFetch } from '@/lib/url-helper';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    console.error(`[MCP-Callback] Zoho returned OAuth error: ${error} - ${errorDescription}`);
    // Redirect back with error
    return NextResponse.json({ error: `OAuth Error: ${errorDescription || error}` }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state parameters' }, { status: 400 });
  }

  try {
    // 1. Retrieve state payload from Firestore using state ID (UUID)
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const stateDocRef = db.collection('mcpOAuthStates').doc(state);
    const stateDoc = await stateDocRef.get();

    if (!stateDoc.exists) {
      console.error('[MCP-Callback] OAuth state not found in Firestore:', state);
      return NextResponse.json({ error: 'OAuth session has expired or is invalid' }, { status: 400 });
    }

    const statePayload = stateDoc.data();
    if (!statePayload) {
      return NextResponse.json({ error: 'OAuth session state is empty' }, { status: 400 });
    }

    const { projectId, serverName, tokenEndpoint, clientId, serverUrl, redirectUri } = statePayload;

    if (!projectId || !serverName || !tokenEndpoint || !clientId || !serverUrl || !redirectUri) {
      return NextResponse.json({ error: 'Invalid state metadata stored in session' }, { status: 400 });
    }

    // Delete the temporary state record so it cannot be reused
    try {
      await stateDocRef.delete();
    } catch (delErr) {
      console.warn('[MCP-Callback] Failed to delete temporary state record:', delErr);
    }

    console.log(`[MCP-Callback] Exchanging code for ${serverName} tokens (project ${projectId})`);

    // 2. Exchange code for access & refresh tokens
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
    });

    // Append PKCE verifier if it was generated
    if (statePayload.codeVerifier) {
      params.append('code_verifier', statePayload.codeVerifier);
    }

    const tokenRes = await safeFetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'MCP-Protocol-Version': '2024-11-05',
      },
      body: params.toString(),
    });

    const tokenText = await tokenRes.text();
    console.log(`[MCP-Callback] Token exchange response status ${tokenRes.status}`);

    let tokenData: any;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (jsonErr) {
      console.error('[MCP-Callback] Failed to parse token response JSON:', jsonErr);
      throw new Error(`Token exchange response was not valid JSON: ${tokenText}`);
    }

    if (!tokenRes.ok || tokenData.error) {
      throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error || tokenText}`);
    }

    if (!tokenData.access_token) {
      throw new Error(`Token exchange response missing access_token: ${tokenText}`);
    }

    // 3. Save credentials securely to subcollection projects/{projectId}/mcpCredentials/{serverName}
    const authData = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      clientId,
      tokenEndpoint,
      scope: tokenData.scope || '',
    };

    await saveMcpAuthForServer(projectId, serverName, authData);

    // 4. Update project mcpConfig & enable the server
    const project = await getProject(projectId);
    if (project) {
      const mcpConfig = project.mcpConfig || { mcpServers: {} };
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      
      // Update/add the server connection configuration
      mcpConfig.mcpServers[serverName] = { url: serverUrl };

      // Ensure the server is enabled
      const enabledMcpServers = project.enabledMcpServers || [];
      if (!enabledMcpServers.includes(serverName)) {
        enabledMcpServers.push(serverName);
      }

      await updateProject(projectId, { mcpConfig, enabledMcpServers });

      // Log activity
      await logActivity(
        projectId,
        'settings_update',
        `MCP Server "${serverName}" added and authenticated via OAuth URL connection.`,
        { serverName, serverUrl }
      );
    }

    // 5. Redirect back to project page with success param (building baseUrl from trusted config to prevent Host header hijacking and 0.0.0.0 binding issues)
    const baseOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : new URL(req.url).origin;
    const returnUrl = new URL(`/project/${projectId}`, baseOrigin);
    returnUrl.searchParams.set('mcp_success', 'true');
    returnUrl.searchParams.set('server', serverName);

    console.log(`[MCP-Callback] Successfully authenticated ${serverName}. Redirecting to: ${returnUrl.toString()}`);
    return NextResponse.redirect(returnUrl.toString());
  } catch (error: any) {
    console.error('API GET OAuth Callback Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

