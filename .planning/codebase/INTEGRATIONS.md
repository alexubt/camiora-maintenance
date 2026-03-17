# External Integrations

**Analysis Date:** 2026-03-16

## APIs & External Services

**Microsoft Graph API:**
- Service: Microsoft Graph (OneDrive file storage backend)
- What it's used for: Upload maintenance records to OneDrive folders
  - Endpoint: `https://graph.microsoft.com/v1.0`
  - OAuth scope: `Files.ReadWrite User.Read`
  - Implementation: `app.js:801-835` (`ensureFolder()` and `uploadFile()` functions)

**Microsoft OAuth 2.0:**
- Service: Azure Active Directory (M365 authentication)
- What it's used for: User authentication and authorization
  - Login endpoint: `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize`
  - Token endpoint: `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`
  - Auth flow: PKCE (Proof Key for Code Exchange) - authorization code flow
  - Implementation: `app.js:19-78` (PKCE generation, token exchange, session storage)
  - Session storage keys: `ms_token`, `ms_token_exp`, `pkce_verifier`

## Data Storage

**Databases:**
- OneDrive (Microsoft Graph) - Primary file storage
  - Connection: Microsoft Graph API via Bearer token (`Authorization: Bearer {accessToken}`)
  - Client: Fetch API (native Web API, no ORM)
  - Folder structure:
    ```
    {ONEDRIVE_BASE}/
    ├── Trucks/
    │   ├── TR-{NUMBER}/
    │   │   └── Maintenance/
    └── Trailers/
        ├── TL-{NUMBER}/
            └── Maintenance/
    ```

**File Storage:**
- OneDrive (via Microsoft Graph API)
  - File types: PDF, image uploads
  - Auto-folder creation: `app.js:801-821` (ensureFolder creates missing directories)
  - File naming: `{PREFIX}-{UNIT}_{SERVICE}_{DATE}_{MILEAGE}mi[-N].{ext}` (e.g., `TR-042_oil-change_2026-03-16_124500mi.pdf`)

**Local Client Storage:**
- Session Storage (transient):
  - `ms_token`: Access token for Microsoft Graph
  - `ms_token_exp`: Token expiration timestamp
  - `pkce_verifier`: PKCE verifier for OAuth code exchange
  - Cleared on sign-out: `app.js:93-97`

**Caching:**
- Service Worker cache (`sw.js`)
  - Cache name: `camiora-v3`
  - Caches: Static assets (HTML, CSS, JS, icons) + downloaded CDN assets
  - No application data caching (token-bound, ephemeral)

## Authentication & Identity

**Auth Provider:**
- Microsoft Azure Active Directory (OAuth 2.0)
  - Implementation: PKCE authorization code flow (secure for public SPAs)
  - Tenant configuration: Supports both single-tenant (`TENANT_ID` = specific ID) and multi-tenant (`TENANT_ID` = "common")
  - Token scope: `Files.ReadWrite User.Read`

**PKCE Implementation:**
- Challenge generation: SHA-256 hash of 64-byte random verifier, base64url encoded (`app.js:26-33`)
- Verifier stored in sessionStorage during auth flow
- Exchanged for access token in `exchangeCodeForToken()` (`app.js:52-78`)
- Token lifetime: Default 3600 seconds (1 hour), stored in sessionStorage
- Refresh: No refresh token implementation; users re-authenticate on token expiry

**Azure App Registration:**
- Required configuration (README.md):
  - Application (client) ID → `CONFIG.CLIENT_ID`
  - Directory (tenant) ID → `CONFIG.TENANT_ID`
  - Redirect URI: Single-page app (SPA) configuration in Azure portal
  - API permissions: Files.ReadWrite, User.Read (delegated)

## Monitoring & Observability

**Error Tracking:**
- None - Console logging only
  - Errors logged to browser console: `console.error()` calls in `app.js:71, 326, 888`
  - User-facing error messages via toast notifications: `showToast()` (`app.js:902-909`)

**Logs:**
- Browser console only (developer tools)
- Example error messages:
  - "Token exchange failed" (`app.js:71`)
  - "Scan error" (`app.js:326`)
  - "Upload failed — check connection" (`app.js:889`)

## CI/CD & Deployment

**Hosting:**
- GitHub Pages
  - Deployment: Manual push to GitHub repo root
  - URL: `https://{USERNAME}.github.io/camiora-maintenance/`
  - Setup: Settings → Pages → Deploy from branch (main/root)

**CI Pipeline:**
- None configured - Static files only

## Environment Configuration

**Required env vars:**
- No `.env` file. Configuration is hardcoded in `app.js:1-7`:
  - `CONFIG.CLIENT_ID` - Azure AD application ID (required)
  - `CONFIG.TENANT_ID` - Azure AD tenant ID (required, set to "common" for multi-tenant)
  - `CONFIG.REDIRECT_URI` - GitHub Pages URL (must match Azure portal redirect URI exactly)
  - `CONFIG.ONEDRIVE_BASE` - OneDrive folder name (default: "Fleet Maintenance")

**Secrets location:**
- None stored locally. OAuth tokens are stored in sessionStorage (ephemeral, cleared on browser close).
- CLIENT_ID is public (visible in deployed code, by design for public SPA with PKCE).
- No API keys, database credentials, or secrets in codebase.

## Webhooks & Callbacks

**Incoming:**
- OAuth redirect callback: `app.js:105-118`
  - URL: `{REDIRECT_URI}?code={authorizationCode}`
  - Trigger: User completes M365 login
  - Handler: Exchanges code for access token, saves to sessionStorage, renders app

**Outgoing:**
- None - App is frontend-only. No server-side webhooks.

---

*Integration audit: 2026-03-16*
