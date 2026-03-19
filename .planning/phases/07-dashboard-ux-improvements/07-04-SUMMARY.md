---
phase: 07-dashboard-ux-improvements
plan: 04
subsystem: ui
tags: [graph-api, pdf, blob-url, auth, fetch]

# Dependency graph
requires:
  - phase: 06-auth-hardening
    provides: getValidToken for silent token refresh
provides:
  - Authenticated PDF viewing via blob URLs in unit detail invoice history
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [blob-url-for-authenticated-file-viewing, data-action-click-handler]

key-files:
  created: []
  modified:
    - app/views/unit-detail.js

key-decisions:
  - "Used getValidToken() instead of state.token for PDF fetch to ensure fresh token on potentially stale pages"

patterns-established:
  - "Blob URL pattern: fetch authenticated file with Bearer token, create blob URL, open in new tab, revoke after 60s"

requirements-completed: [D17]

# Metrics
duration: 1min
completed: 2026-03-19
---

# Phase 7 Plan 4: Fix Invoice PDF Links Summary

**Authenticated PDF viewing via Graph API fetch with Bearer token and blob URL display in new tab**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-19T20:30:47Z
- **Completed:** 2026-03-19T20:31:48Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Invoice PDF "View" links now fetch the file via Graph API with a fresh Bearer token
- PDFs open in a new browser tab via blob URL instead of failing on unauthenticated Graph API href
- Loading state shown on link while fetching, with error handling and user-visible alert on failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace invoice PDF href links with authenticated blob fetch** - `e8a9a54` (feat)

## Files Created/Modified
- `app/views/unit-detail.js` - Added getValidToken import, handleViewPdf function, view-pdf data-action handler, replaced direct Graph API href with click-to-fetch pattern

## Decisions Made
- Used getValidToken() instead of state.token to ensure fresh token even if user has been on the page for a while past token expiry
- Added null-token guard in handleViewPdf that throws "Not authenticated" for clear error messaging

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Invoice PDF links are now functional with proper authentication
- No blockers for remaining phase 7 plans

---
*Phase: 07-dashboard-ux-improvements*
*Completed: 2026-03-19*
