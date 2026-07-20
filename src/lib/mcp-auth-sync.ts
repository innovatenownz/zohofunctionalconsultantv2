import { getAdminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { safeFetch } from './url-helper';

export interface McpServerAuth {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  tokenEndpoint: string;
  scope?: string;
}

/**
 * Load the stored OAuth tokens for a specific MCP server within a project.
 * Tokens are stored in a secure subcollection `projects/{projectId}/mcpCredentials/{serverName}`.
 * Falls back to reading from legacy project document `projects/{projectId}.mcpAuth.{serverName}` and migrates if found.
 */
export async function getMcpAuthForServer(
  projectId: string,
  serverName: string
): Promise<McpServerAuth | null> {
  const db = getAdminDb();
  if (!db) return null;

  try {
    // 1. Try to read from the secure subcollection
    const subDoc = await db
      .collection('projects')
      .doc(projectId)
      .collection('mcpCredentials')
      .doc(serverName)
      .get();

    if (subDoc.exists) {
      return (subDoc.data() as McpServerAuth) || null;
    }

    // 2. Fallback to legacy project document field
    const projectDoc = await db.collection('projects').doc(projectId).get();
    const data = projectDoc.data();
    const legacyAuth = data?.mcpAuth?.[serverName] as McpServerAuth;

    if (legacyAuth) {
      console.log(`[MCP-Auth] Found legacy credentials for ${serverName} in project document. Migrating...`);
      // Save to secure subcollection and clean up legacy field
      await saveMcpAuthForServer(projectId, serverName, legacyAuth);
      return legacyAuth;
    }

    return null;
  } catch (err) {
    console.error('[MCP-Auth] Error reading auth from Firestore:', err);
    return null;
  }
}

/**
 * Persist OAuth tokens for a specific MCP server within a project to a secure subcollection in Firestore.
 * Cleans up any legacy field in the project document to prevent data leakage.
 */
export async function saveMcpAuthForServer(
  projectId: string,
  serverName: string,
  auth: McpServerAuth
): Promise<void> {
  const db = getAdminDb();
  if (!db) return;

  try {
    // 1. Save to the secure subcollection
    await db
      .collection('projects')
      .doc(projectId)
      .collection('mcpCredentials')
      .doc(serverName)
      .set({
        ...auth,
        updatedAt: new Date().toISOString(),
      });
    console.log(`[MCP-Auth] Saved tokens for ${serverName} in project ${projectId}/mcpCredentials`);

    // 2. Clean up legacy credentials field in project document if present
    const projectRef = db.collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();
    if (projectDoc.exists) {
      const data = projectDoc.data();
      if (data?.mcpAuth?.[serverName]) {
        await projectRef.update({
          [`mcpAuth.${serverName}`]: FieldValue.delete(),
        });
        console.log(`[MCP-Auth] Cleaned up legacy credentials field for ${serverName} in project document`);
      }
    }
  } catch (err) {
    console.error('[MCP-Auth] Error saving auth to Firestore:', err);
    throw err;
  }
}

/**
 * Discover the OAuth token endpoint from the MCP server's well-known metadata.
 * Zoho MCP servers expose their own token endpoint via this discovery mechanism.
 * The real endpoint is Zoho-installation-specific — e.g.:
 *   https://mcp.zoho.com.au/baas/mcp/v1/oauth/<hash>/<orgId>/token
 */
export async function discoverTokenEndpoint(serverUrl: string): Promise<string | null> {
  const origin = new URL(serverUrl).origin;
  const wellKnownUrl = `${origin}/.well-known/oauth-authorization-server`;

  try {
    const response = await safeFetch(wellKnownUrl, {
      headers: { 'MCP-Protocol-Version': '2024-11-05' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.token_endpoint || null;
  } catch {
    return null;
  }
}

export interface OAuthMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

/**
 * Fetch full OAuth metadata from the well-known endpoint of the server.
 */
export async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata | null> {
  try {
    const origin = new URL(serverUrl).origin;
    const wellKnownUrl = `${origin}/.well-known/oauth-authorization-server`;
    
    const response = await safeFetch(wellKnownUrl, {
      headers: { 'MCP-Protocol-Version': '2024-11-05' },
    });
    if (!response.ok) return null;
    
    const data = await response.json();
    return {
      issuer: data.issuer,
      authorizationEndpoint: data.authorization_endpoint,
      tokenEndpoint: data.token_endpoint,
      registrationEndpoint: data.registration_endpoint,
      scopesSupported: data.scopes_supported,
    };
  } catch (err) {
    console.error('[MCP-Auth] Metadata discovery failed:', err);
    return null;
  }
}

/**
 * Use the refresh_token to get a new access_token.
 * Automatically discovers the correct Zoho MCP token endpoint if not configured.
 * Persists the updated tokens to Firestore.
 */
export async function refreshAccessToken(
  projectId: string,
  serverName: string,
  auth: McpServerAuth,
  serverUrl?: string
): Promise<McpServerAuth> {
  console.log(`[MCP-Auth] Refreshing access token for ${serverName} (project ${projectId})...`);

  // Discover the real token endpoint if we don't have it, or if it looks like a generic fallback
  let tokenEndpoint = auth.tokenEndpoint;
  if (!tokenEndpoint || tokenEndpoint.includes('accounts.zoho.com') || tokenEndpoint === '') {
    const url = serverUrl || auth.tokenEndpoint;
    if (url && url.startsWith('http')) {
      // Try discovering from the server URL
      const serverOriginUrl = serverUrl || '';
      if (serverOriginUrl) {
        const discovered = await discoverTokenEndpoint(serverOriginUrl);
        if (discovered) {
          console.log(`[MCP-Auth] Discovered token endpoint: ${discovered}`);
          tokenEndpoint = discovered;
        }
      }
    }
  }

  if (!tokenEndpoint) {
    throw new Error('No token endpoint configured and discovery failed');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: auth.clientId,
    refresh_token: auth.refreshToken,
  });

  const response = await safeFetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const responseText = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    data = null;
  }

  const safeMetadata = {
    status: response.status,
    has_access_token: Boolean(data?.access_token),
    has_refresh_token: Boolean(data?.refresh_token),
    expires_in: data?.expires_in ?? null,
    token_type: data?.token_type ?? null,
    error: data?.error ?? null,
    error_description: data?.error_description ?? null,
  };
  console.log('[MCP-Auth] Token refresh response metadata:', safeMetadata);

  if (!response.ok) {
    const errorCode = typeof data?.error === 'string' ? data.error : 'unknown_error';
    const errorDescription = typeof data?.error_description === 'string'
      ? data.error_description
      : 'Token refresh request failed';
    throw new Error(`Token refresh failed (${response.status}): ${errorCode} — ${errorDescription}`);
  }

  if (!data) {
    throw new Error('Token refresh returned non-JSON response');
  }

  if (data.error) {
    const errorCode = typeof data.error === 'string' ? data.error : 'unknown_error';
    const errorDescription = typeof data.error_description === 'string'
      ? data.error_description
      : '';
    throw new Error(`Token refresh error from Zoho: ${errorCode}${errorDescription ? ` — ${errorDescription}` : ''}`);
  }

  if (!data.access_token || typeof data.access_token !== 'string') {
    throw new Error(`Token refresh succeeded (HTTP ${response.status}) but no access_token in response`);
  }

  const updatedAuth: McpServerAuth = {
    ...auth,
    accessToken: data.access_token,
    tokenEndpoint, // save the discovered endpoint for future use
    ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}),
  };

  await saveMcpAuthForServer(projectId, serverName, updatedAuth);
  console.log(`[MCP-Auth] Access token refreshed successfully for ${serverName}`);

  return updatedAuth;
}
