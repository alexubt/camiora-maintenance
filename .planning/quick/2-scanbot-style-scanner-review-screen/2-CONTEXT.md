# Quick Task 2: Scanbot-style scanner review screen - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Task Boundary

Replace the current blind-process scanner flow with a post-capture review screen. After the native camera captures a photo, show a review screen where the user can:
1. See the detected document edges overlaid on the photo
2. Drag corner handles to adjust the crop quad
3. Pick a filter (Original, Grayscale, B&W) via thumbnail strip
4. Accept (applies perspective warp + filter, creates blob) or Retake (re-opens camera)

Keep `<input type="file" capture="environment">` for camera — do NOT switch to getUserMedia.

</domain>

<decisions>
## Implementation Decisions

### Corner handles
- Direct drag on 4 circle handles placed at detected corners
- Canvas redraws the quad outline in real-time as user drags
- Touch-friendly: handle hit area at least 44x44px

### Filter picker
- Thumbnail strip at bottom: Original, Grayscale, B&W
- Tap to switch the main preview canvas
- No "Enhanced" filter — this is an internal tool, B&W is the primary output

### Flow
- Native camera → review screen → accept/retake
- On accept: apply perspective warp with user-adjusted corners + selected filter
- On retake: re-open camera input
- Review screen replaces the current scan zone temporarily (not a new route)

### Claude's Discretion
- Exact CSS styling of the review screen
- Handle size and touch behavior details
- Whether to show the edge overlay as a solid line or dashed

</decisions>

<specifics>
## Specific Ideas

- Review screen should feel full-width within the form area, not a modal
- The quad overlay should be a semi-transparent colored polygon (green-ish to match the app theme)
- Corner handles: white circles with a green border, ~20px radius
- Filter thumbnails: small square crops of the same image with each filter applied

</specifics>
