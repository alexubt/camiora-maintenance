---
phase: 06-auth-hardening-and-pwa-reliability
plan: 03
subsystem: storage
tags: [indexeddb, offline, upload-queue, service-worker, pwa]

# Dependency graph
requires:
  - phase: 06-01
    provides: getValidToken with silent refresh for auth before drain
  - phase: 06-02
    provides: SW cache versioning pattern
provides:
  - IndexedDB upload queue (enqueueUpload, dequeueAll, removeJob)
  - Shared IDB openDB module (version 2 with both fleet + uploadQueue stores)
  - Offline upload guard in upload form
  - Automatic queue drain on reconnect and at boot
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [shared-idb-opener, offline-queue-with-drain, network-error-fallback-to-queue]

key-files:
  created:
    - app/storage/db.js
    - app/storage/uploadQueue.js
    - app/storage/uploadQueue.test.js
  modified:
    - app/storage/cache.js
    - app/views/upload.js
    - app/main.js
    - sw.js

key-decisions:
  - "Shared db.js module for IDB version 2 -- avoids version conflicts between cache.js and uploadQueue.js"
  - "DI pattern for dbProvider in queue functions -- enables unit testing with in-memory mock"
  - "Network TypeError in upload catch also queues -- handles mid-upload connectivity loss"
  - "SW cache bumped to v7 to include new modules"

patterns-established:
  - "Shared IDB opener: all stores declared in one place (db.js) to prevent version conflicts"
  - "Offline-first queue: check navigator.onLine before network ops, enqueue on failure"

requirements-completed: [INFRA-03]

# Metrics
duration: 5min
completed: 2026-03-17
---

# Phase 6 Plan 3: Offline Upload Queue Summary

**IndexedDB upload queue with offline guard, network error fallback, and automatic drain on reconnect using shared IDB v2 database**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-17T06:13:13Z
- **Completed:** 2026-03-17T06:17:47Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created shared IDB opener (db.js) with version 2 supporting both fleet and uploadQueue stores
- Built uploadQueue.js with enqueueUpload, dequeueAll, removeJob -- all with DI for testability
- Added offline guard in upload form: queues uploads when !navigator.onLine
- Added network error fallback: TypeError from fetch during upload also queues to IDB
- Implemented drainUploadQueue in main.js: serial drain with auth check and toast per completed item
- Registered online event listener and boot-time drain for leftover jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Create uploadQueue.js with IndexedDB queue and tests** - `62011ca` (feat)
2. **Task 2: Wire offline guard in upload.js and queue drain in main.js** - `ae29d42` (feat)

## Files Created/Modified
- `app/storage/db.js` - Shared IDB opener with version 2, creates fleet + uploadQueue stores
- `app/storage/uploadQueue.js` - enqueueUpload, dequeueAll, removeJob with DI support
- `app/storage/uploadQueue.test.js` - 5 unit tests with in-memory IDB mock
- `app/storage/cache.js` - Updated to import shared openDB from db.js
- `app/views/upload.js` - Offline guard and network error fallback in handleSubmit
- `app/main.js` - drainUploadQueue function, online event listener, boot drain
- `sw.js` - Added db.js and uploadQueue.js to STATIC, bumped cache to v7

## Decisions Made
- Created shared db.js rather than duplicating IDB open logic -- prevents version conflicts
- Used DI pattern (dbProvider parameter) for uploadQueue functions to enable unit testing without browser IDB
- Network TypeError in upload catch triggers queue fallback -- handles mid-upload connectivity loss
- Bumped SW cache to v7 to force update with new modules

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock IDB result property for put operation**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** In-memory IDB mock's put() didn't expose `result` property correctly for auto-incremented id
- **Fix:** Used Object.defineProperty for onsuccess/onerror setters so req.result is readable before callback
- **Files modified:** app/storage/uploadQueue.test.js
- **Verification:** All 5 tests pass
- **Committed in:** 62011ca (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test mock)
**Impact on plan:** Minimal -- test mock needed correct IDB semantics. No scope creep.

## Issues Encountered
None beyond the test mock fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 6 plans complete (01: silent token refresh, 02: install prompt + SW, 03: offline upload queue)
- App is now fully offline-capable for upload operations
- Queue drain handles auth refresh before retrying uploads

---
*Phase: 06-auth-hardening-and-pwa-reliability*
*Completed: 2026-03-17*
