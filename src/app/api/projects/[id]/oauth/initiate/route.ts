import { NextResponse } from 'next/server';
import { getProject } from '@/lib/project-service';
import { discoverOAuthMetadata } from '@/lib/mcp-auth-sync';
import { getAdminDb } from '@/lib/firebase-admin';
import { getSession } from '@/lib/auth';
import { isSafeUrl } from '@/lib/url-helper';
import crypto from 'crypto';

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

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
    const { serverName, serverUrl } = await req.json();

    if (!serverName || !serverUrl) {
      return NextResponse.json({ error: 'Missing serverName or serverUrl' }, { status: 400 });
    }

    // Verify project exists
    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 1. Discover OAuth Metadata
    if (!(await isSafeUrl(serverUrl))) {
      return NextResponse.json({ error: 'Unsafe or invalid serverUrl provided' }, { status: 400 });
    }

    console.log(`[MCP-OAuth] Discovering metadata for ${serverName} at ${serverUrl}`);
    const metadata = await discoverOAuthMetadata(serverUrl);
    if (!metadata) {
      return NextResponse.json({ error: 'Failed to discover OAuth metadata from Zoho server' }, { status: 400 });
    }

    if (!metadata.authorizationEndpoint || !metadata.tokenEndpoint) {
      return NextResponse.json({ error: 'Authorization or Token endpoint not exposed by server' }, { status: 400 });
    }

    // Validate discovered endpoints against SSRF
    if (!(await isSafeUrl(metadata.authorizationEndpoint))) {
      return NextResponse.json({ error: 'Discovered authorization endpoint is unsafe' }, { status: 400 });
    }
    if (!(await isSafeUrl(metadata.tokenEndpoint))) {
      return NextResponse.json({ error: 'Discovered token endpoint is unsafe' }, { status: 400 });
    }
    if (metadata.registrationEndpoint) {
      if (!(await isSafeUrl(metadata.registrationEndpoint))) {
        console.warn(`[MCP-OAuth] Unsafe DCR registration endpoint blocked: ${metadata.registrationEndpoint}`);
        metadata.registrationEndpoint = undefined;
      }
    }

    // 2. Determine redirect URI dynamically from trusted server config to prevent Host header attacks and 0.0.0.0 binding issues
    const baseOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : new URL(req.url).origin;
    const redirectUri = `${baseOrigin}/api/auth/mcp/callback`;
    console.log(`[MCP-OAuth] Redirect URI will be: ${redirectUri}`);

    // 3. Register client dynamically (DCR) if registration endpoint is available
    let clientId = '1000.74OGCXOVDQ7CEELAD7VUSDCCDS433P'; // Default fallback
    if (metadata.registrationEndpoint) {
      console.log(`[MCP-OAuth] Dynamic client registration at ${metadata.registrationEndpoint}`);
      try {
        const dcrRes = await fetch(metadata.registrationEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': '2024-11-05',
          },
          body: JSON.stringify({
            client_name: 'Zoho Consultant Agent',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_method: 'none',
          }),
        });

        if (dcrRes.ok) {
          const dcrData = await dcrRes.json();
          if (dcrData.client_id) {
            clientId = dcrData.client_id;
            console.log(`[MCP-OAuth] DCR Succeeded. Client ID: ${clientId}`);
          }
        } else {
          const errText = await dcrRes.text();
          console.warn(`[MCP-OAuth] DCR registration returned status ${dcrRes.status}: ${errText}. Using fallback client_id.`);
        }
      } catch (dcrErr) {
        console.error('[MCP-OAuth] DCR registration failed. Using fallback client_id.', dcrErr);
      }
    } else {
      console.log('[MCP-OAuth] No registration endpoint found. Using fallback client_id.');
    }


    // 4. Store state payload in Firestore to avoid 250 character limit in Zoho Accounts
    const stateId = crypto.randomUUID();
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Generate PKCE values
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = base64URLEncode(crypto.createHash('sha256').update(codeVerifier).digest());

    const statePayload = {
      projectId,
      serverName,
      tokenEndpoint: metadata.tokenEndpoint,
      clientId,
      serverUrl,
      redirectUri, // store the redirect_uri used during registration/authorization
      codeVerifier, // store the PKCE verifier for the callback exchange
      createdAt: new Date().toISOString()
    };

    await db.collection('mcpOAuthStates').doc(stateId).set(statePayload);
    const state = stateId;

    const defaultScopes = [
      'ZohoCRM.settings.fields.UPDATE',
      'ZohoCRM.settings.modules.READ',
      'ZohoCRM.settings.modules.UPDATE',
      'ZohoCRM.settings.fields.CREATE',
      'ZohoCRM.settings.modules.CREATE',
      'ZohoCRM.settings.fields.READ',
      'ZohoCRM.settings.automation_actions.READ',
      'ZohoCRM.settings.global_picklist.UPDATE',
      'ZohoCRM.settings.global_picklist.ALL',
      'ZohoCRM.settings.related_lists.READ',
      'ZohoCRM.modules.ALL',
      'ZohoMCP.tool.execute',
    ];
    
    const scopes = defaultScopes.join(' ');

    const authUrl = `${metadata.authorizationEndpoint}?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scopes)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    console.log(`[MCP-OAuth] Authorize redirect url built: ${authUrl}`);
    return NextResponse.json({ url: authUrl });
  } catch (error: any) {
    console.error('API POST OAuth Initiate Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
