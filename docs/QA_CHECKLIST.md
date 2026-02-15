# Slothodoro QA Checklist

Use this checklist before shipping changes (especially timer logic, notifications, and PWA behavior).

## Timer controls
- [ ] Start works from a fresh page load
- [ ] Pause works while running
- [ ] Reset returns to the beginning of the current phase and clears any "running" state
- [ ] Skip advances to the next phase

## Presets
- [ ] Presets apply correctly (durations + counts, as intended)
- [ ] Switching presets while paused updates the next run correctly

## Nudge
- [ ] Nudge ±1m works while running
- [ ] Nudge does not go below 0:00

## Phase transitions
- [ ] Auto-start next phase (if enabled/expected by current UX)
- [ ] Phase label + timer display update correctly at boundaries

## Notifications
- [ ] Notification permission request flow is sane (no repeated prompts)
- [ ] Notification fires only when tab is hidden (as intended)
- [ ] Notification content is correct (phase name, etc.)

## Wake lock
- [ ] Wake lock toggle works where supported
- [ ] App behaves reasonably where unsupported (no errors / clear disabled state)

## PWA / offline
- [ ] PWA install flow works
- [ ] App loads offline after install (service worker + cached assets)

## Export session card
- [ ] Export session card opens
- [ ] Copy works
- [ ] Download works

## Stats
- [ ] Stats (today) correct
- [ ] Stats (all-time) correct
- [ ] Clear resets stats as expected
