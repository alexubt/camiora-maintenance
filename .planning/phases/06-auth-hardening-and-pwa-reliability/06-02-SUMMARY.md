---
phase: 06-auth-hardening-and-pwa-reliability
plan: 02
subsystem: pwa
tags: [pwa, install-prompt, manifest, service-worker, ios, android]

requires:
  - phase: 01-foundation
    provides: "Service worker registration and manifest.json"
  - phase: 05-dashboard
    provides: "Dashboard and unit-detail views added to app"
provides:
  - "PWA install banners for iOS (instructional) and Android (beforeinstallprompt)"
  - "Correct manifest.json start_url and scope for GitHub Pages deployment"
  - "SW cache v6 with all app modules in STATIC list"
affects: []

tech-stack:
  added: []
  patterns: ["Platform-detect install prompt (iOS instructional vs Android native)", "Session-scoped banner dismissal via sessionStorage"]

key-files:
  created: ["app/install.js"]
  modified: ["manifest.json", "sw.js", "app/main.js", "style.css"]

key-decisions:
  - "Install banner appended to document.body (not #app) so it survives route changes"
  - "sessionStorage for dismissal (not localStorage) so users see prompt again next session"
  - "beforeinstallprompt listener registered at module load, not inside initInstallPrompt()"

patterns-established:
  - "Platform detection: isIOS() checks UA + not standalone; isInstalled() checks display-mode media query"
  - "Banner dismissal: sessionStorage key prevents re-show within same browser session"

requirements-completed: [INFRA-01]

duration: 3min
completed: 2026-03-17
---

# Phase 6 Plan 2: PWA Install Prompt Summary

**Platform-aware install banners (iOS share-sheet instructions, Android native prompt) with fixed manifest.json scope for GitHub Pages**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-17T06:04:37Z
- **Completed:** 2026-03-17T06:07:14Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Fixed manifest.json start_url and scope to /camiora-maintenance/ for correct GitHub Pages PWA behavior
- Created app/install.js with platform-aware install banners (iOS instructional, Android native beforeinstallprompt)
- Updated SW STATIC cache list to v6 with all app modules including Phase 4/5 views
- Added install banner CSS with dismiss and action button styling

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix manifest.json and create install.js module** - `86a700f` (feat)
2. **Task 2: Wire install prompt into boot and update SW cache** - `4481b22` (feat)

## Files Created/Modified
- `app/install.js` - Install prompt module with iOS/Android banner logic and platform detection
- `manifest.json` - Fixed start_url and scope for /camiora-maintenance/ GitHub Pages path
- `sw.js` - Bumped cache to v6, added install.js and all Phase 4/5 modules to STATIC list
- `app/main.js` - Imported and called initInstallPrompt() after router init
- `style.css` - Added .install-banner styles (fixed bottom, dismiss, action button)

## Decisions Made
- Install banner appended to document.body (not #app) so it survives SPA route changes
- sessionStorage for dismissal -- resets each browser session so users see prompt again next visit
- beforeinstallprompt event listener registered at module load time, not deferred to initInstallPrompt() call
- initInstallPrompt() placed after router init but outside auth-gated block so unauthenticated users also see it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added missing Phase 4/5 modules to SW STATIC list**
- **Found during:** Task 2
- **Issue:** SW STATIC list was missing dashboard.js, unit-detail.js, naming.js, record.js, schedule.js from Phases 4-5
- **Fix:** Added all 5 missing modules to STATIC array alongside install.js
- **Files modified:** sw.js
- **Verification:** All module paths verified against filesystem
- **Committed in:** 4481b22 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Plan explicitly anticipated this fix. No scope creep.

## Issues Encountered
- Pre-existing test failures in auth.test.js (getValidToken, refreshAccessToken not yet implemented) -- these are from Phase 06-01 scope, not caused by this plan's changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PWA install flow complete for both platforms
- Manifest correctly scoped for GitHub Pages deployment
- SW cache comprehensive with all app modules

---
*Phase: 06-auth-hardening-and-pwa-reliability*
*Completed: 2026-03-17*
