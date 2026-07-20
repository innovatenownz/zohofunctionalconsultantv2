<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project Overview

"Zoho Suite & Integration Consultant Agent" — a Next.js app that acts as an AI business-analyst agent for Zoho product implementations. A user creates a "Project" (a client engagement), links a Google Drive folder of requirements docs, and configures one or more MCP servers (typically Zoho's MCP endpoints). The agent (Gemini via Vertex AI) reads the Drive docs plus prior chat context, proposes CRM modules/fields/workflows, and executes them by calling tools on the connected MCP server(s). Everything is persisted per-project in Firestore.

## Commands

- `npm run dev` — start dev server (`next dev -H 0.0.0.0`, binds all interfaces, port 3000)
- `npm run build` — production build (`next build`)
- `npm run start` — serve the built app (`next start`); required before Playwright runs, since Playwright's `webServer` shells out to this
- `npm run lint` — ESLint (flat config: `eslint-config-next` core-web-vitals + typescript)
- No `test` script is defined. Run Playwright E2E tests directly:
  - `npx playwright test` — full suite
  - `npx playwright test tests/multi-chat.spec.ts` — single file
  - `npx playwright test -g "should support creating"` — single test by title
  - Playwright's `webServer` auto-starts `npm run start` with `NEXTAUTH_SECRET=dummy_secret_for_tests` and `PLAYWRIGHT_TEST=true`. That second var makes `getSession()` (`src/lib/auth.ts`) short-circuit to a fake signed-in user, bypassing real Google OAuth — this is what lets E2E tests hit authenticated API routes without a real login.
- `node scripts/deploy.mjs [--dry-run] [--env=production|preprod]` — full deploy pipeline: lint (non-fatal) → build (fatal) → `npx playwright test` (fatal) → `gcloud run deploy`. Environment is inferred from the current git branch (`main` → production, `pre-production` → preprod) unless overridden with `--env`.

## Architecture

**Stack**: Next.js 16 (App Router, `output: "standalone"`), React 19, TypeScript, Tailwind v4, NextAuth (Google OAuth, JWT sessions), Firebase Admin/Firestore, Google GenAI SDK (`@google/genai`) over Vertex AI, `@modelcontextprotocol/sdk`, `googleapis` (Drive). Path alias `@/*` → `src/*`.

### Data layer (`src/lib/project-service.ts`, `src/lib/firebase-admin.ts`)
- Firestore is accessed through a **named database `"zhfnctl03"`**, not `(default)` — both `firebase-admin.ts` (server) and `firebase.ts` (client) pass this explicitly. Keep that in mind when adding any new Firestore access.
- If `FIREBASE_PROJECT_ID` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` aren't set, `getAdminDb()` returns `null` and `project-service.ts` transparently falls back to in-memory arrays (seeded with 3 example projects: Acme Corp, Globex Inc, Stark Industries). This makes local dev possible without cloud credentials, but state resets on restart and isn't shared across instances — don't rely on it for anything persistent.
- Firestore layout: `projects/{id}` (doc), with subcollections `activities`, `chats`, and `mcpCredentials/{serverName}` (OAuth tokens, kept out of the main doc for isolation). A legacy single-doc chat format (`chats/{projectId}`) is auto-migrated into the subcollection the first time `listChats()` runs for a project.
- `updateProjectMemoryFromExecution` maintains a heuristic `project.memorySpec.activeModules` blueprint (module → fields/automations) updated after successful MCP tool calls whose action name contains "module"/"field"/"workflow"/"blueprint". This blueprint is re-injected into the agent's system prompt so it doesn't recreate schema that already exists.

### Auth (`src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`)
- Single Google OAuth provider; requests `drive.readonly` scope so the same session can read the linked Drive folder. JWT strategy stores `accessToken`/`refreshToken` on the token/session.
- `authOptions` module throws at import time if `NEXTAUTH_SECRET` is missing, unless `NEXT_PHASE === 'phase-production-build'` (so `next build` doesn't need real secrets).
- Every API route calls `getSession()` (not `getServerSession` directly) so the Playwright test bypass above applies uniformly.

### AI agent (`src/lib/agents/business-analyst.ts`)
- Uses Vertex AI, not an API key: the lazy `getAI()` singleton deletes `GOOGLE_API_KEY` from `process.env` and sets `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION` before constructing `GoogleGenAI({ vertexai: true })`. Model is `gemini-2.5-pro`.
- Both `src/app/api/chat/route.ts` and `src/app/api/projects/[id]/sync/route.ts` write a temporary service-account key file (from the Firebase Admin env vars) to `os.tmpdir()/.gcp-temp-key.json` and point `GOOGLE_APPLICATION_CREDENTIALS` at it if that var isn't already set — this is how Vertex AI auth is bootstrapped without a mounted credentials file.
- **Agent/MCP protocol**: the system prompt instructs the model to emit a fenced ` ```mcp-command ` JSON block to call MCP tools, and to call the special `list_tools` action first rather than inventing tool names (tool names are unknown up front). Critically, the prompt tells the model to **stop generating immediately** after emitting a command block and never fabricate the execution result — the backend (`src/app/api/chat/route.ts`) regex-extracts the block after the stream ends, actually executes it via `executeMCPCommand`, and appends the real `✅`/`❌` result text to the stream. Any change to this prompt or to the extraction regex must keep both sides in sync.
- Cross-chat memory: when responding, the route also gathers summaries of the project's *other* chat sessions (`generateChatSummary`, run in the background after each turn) and injects them as "PREVIOUS CHAT THREADS CONTEXT" so the agent can reference earlier sessions.

### MCP integration (`src/lib/agents/mcp-agent.ts`, `src/lib/mcp-auth-sync.ts`)
- Supports remote MCP servers over Streamable HTTP (with `Authorization: Bearer <token>`) and local stdio-spawned servers. Stdio transport is **rejected when `HOSTED=true` or `NODE_ENV=production`** — only allowed in local dev.
- On a 401 from a URL-based server, tool listing/execution automatically refreshes the OAuth access token once (`handleTokenRefresh` → `refreshAccessToken`) and retries before failing.
- Connecting a Zoho MCP server has two paths:
  1. **OAuth flow** (`src/app/api/projects/[id]/oauth/initiate/route.ts` → `src/app/api/auth/mcp/callback/route.ts`): discovers RFC 8414 metadata at `/.well-known/oauth-authorization-server`, does dynamic client registration if a registration endpoint is offered, generates PKCE, and stores the pending OAuth state in Firestore (`mcpOAuthStates/{uuid}`) rather than in the `state` query param — Zoho's authorize URL has a ~250-character `state` limit that a redirect URI + PKCE payload would exceed.
  2. **Manual credentials** (`src/app/api/projects/[id]/credentials/route.ts`): user pastes a `{client_id, refresh_token, token_endpoint?}` JSON blob; the route self-verifies by performing an immediate token refresh before persisting, and deletes what it just wrote if verification fails.
- All server-supplied/user-supplied URLs (OAuth metadata, token endpoints, DCR registration endpoints) must go through `isSafeUrl`/`safeFetch` in `src/lib/url-helper.ts`, which resolve DNS and block requests to private/internal IPs (SSRF hardening) while pinning the actual request to the resolved IP with the correct `Host`/SNI. Don't call `fetch` directly on user-provided server URLs.

### Google Drive (`src/lib/google-drive.ts`)
Prefers the Firebase Admin service account (broad access, doesn't depend on the signed-in user); falls back to the signed-in user's NextAuth Google OAuth token if no service account is configured. Exports Google Docs/Sheets to text/CSV; reads plain text/markdown/JSON/CSV directly.

### Frontend
- `src/app/DashboardClient.tsx` — project list with search/status/tag filtering and a create-project modal.
- `src/app/project/[id]/page.tsx` (~1900 lines) — the main workspace: two tabs (Chat History, Settings & Context), multi-chat session sidebar (create/rename/delete, backed by the `chats` subcollection), MCP server management (OAuth or manual credentials, per-server enable/disable), a tools browser, and project spec/roadmap editing with a Drive-sync trigger.
- `src/app/components/A2UIWidget.tsx` — renders MCP tool-call JSON results as a searchable/paginated widget when the payload parses as JSON, otherwise falls back to a raw `<pre>` block.

## Deployment

- `Dockerfile`: multi-stage, produces the `next build --output standalone` runtime image. `NEXT_PUBLIC_FIREBASE_*` are baked in at build time via `ARG`/`ENV` (these are public web-config values, not secrets, but they default to this project's real values in the Dockerfile — override via `--build-arg` for a different Firebase project).
- `scripts/deploy.mjs` maps branch → Cloud Run service: `main` → `zoho-consultant-agent` (production), `pre-production` → `zoho-consultant-agent-pre-production` (preprod), region `asia-south1`, tagged `v<short-sha>`. Config comes from `env.production.yaml` / `env.preprod.yaml` (gitignored — see the checked-in `.example` files for the shape). Those files only carry non-secret config (`NEXTAUTH_URL`, client IDs, project IDs); true secrets (`NEXTAUTH_SECRET`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`) are expected to be supplied out-of-band (e.g. Cloud Run secret bindings), not through `--env-vars-file`.
