---
phase: 06-auth-hardening-and-pwa-reliability
plan: 01
subsystem: auth
tags: [pkce, refresh-token, offline_access, microsoft-graph, token-rotation]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: PKCE auth flow, state management, CSV data layer
provides:
  - Silent token refresh via offline_access scope and rotating refresh tokens
  - getValidToken() auto-refresh utility for all Graph API callers
  - AUTH_EXPIRED error pattern for expired sessions
affects: [06-02, 06-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [getValidToken-guard, rotating-refresh-token-in-sessionStorage-only]

key-files:
  created: [app/graph/auth.test.js]
  modified: [app/graph/auth.js, app/graph/files.js, app/main.js, app/views/upload.js]

key-decisions:
  - "Refresh token stored only in sessionStorage, never in state object, to prevent stale rotating token copies"
  - "getValidToken refreshes when within 5 min of expiry, returns existing token if still valid"
  - "saveToken accepts both object (new) and string (legacy) for backward compatibility"

patterns-established:
  - "getValidToken guard: all Graph API callers use const token = await getValidToken() with AUTH_EXPIRED throw"
  - "Token DI pattern: csv.js receives token as parameter, callers pass getValidToken result"

requirements-completed: [INFRA-02]

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 6 Plan 1: Silent Token Refresh Summary

**PKCE refresh token flow with offline_access scope, 5-min auto-refresh threshold, and getValidToken guard on all Graph API callers**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-17T06:04:53Z
- **Completed:** 2026-03-17T06:10:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added offline_access scope to PKCE flow for refresh token support
- Implemented refreshAccessToken() with rotating token storage in sessionStorage
- Created getValidToken() that auto-refreshes when within 5 min of token expiry
- Wired all Graph API callers (files.js, main.js, upload.js) to use getValidToken
- 9 unit tests covering all refresh and token validation behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add refresh token support to auth.js with tests** - `02ad60a` (feat, TDD)
2. **Task 2: Wire getValidToken into all Graph API callers** - `51c4a17` (feat)

## Files Created/Modified
- `app/graph/auth.js` - Added offline_access, saveToken(tokenData), refreshAccessToken, getValidToken, explicit signOut cleanup
- `app/graph/auth.test.js` - 9 unit tests for SCOPES, saveToken, signOut, getValidToken, refreshAccessToken
- `app/graph/files.js` - Replaced state.token with getValidToken() in ensureFolder and uploadFile
- `app/main.js` - Pass full tokenData to saveToken on login, use getValidToken for fleet data loading
- `app/views/upload.js` - Use getValidToken for appendInvoiceRecord, session-expired toast

## Decisions Made
- Refresh token stored only in sessionStorage (not in state object) to prevent stale rotating token copies per Microsoft best practice
- getValidToken uses 5-minute threshold before expiry to trigger proactive refresh
- saveToken maintains backward compatibility with legacy string signature
- loadToken returns true when refresh token exists even if access token expired (enables silent refresh on next API call)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Token refresh infrastructure complete, ready for offline/PWA reliability work in 06-02
- All Graph API callers use getValidToken pattern consistently

---
*Phase: 06-auth-hardening-and-pwa-reliability*
*Completed: 2026-03-17*
