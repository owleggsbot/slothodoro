# Slothodoro QA checklist

Use this checklist before cutting a release or after any timer/UI/notifications change.

## Setup

- Test on a fresh profile once (no prior `localStorage`).
- Also test on a profile with existing data.
- Recommended coverage:
  - Desktop: Chrome, Firefox, Safari
  - Mobile: iOS Safari, Android Chrome

## Desktop (Chrome / Firefox / Safari)

### Core timer controls

- Start → timer begins counting down.
- Pause → countdown stops; waiting ~5–10s should not change remaining time.
- Resume → continues from the paused remaining time.
- Reset → returns to initial duration for current phase.
- Skip → advances to the next phase.

### Nudge ±1m

- While running: +1m increases remaining time by ~60 seconds.
- While running: -1m decreases remaining time by ~60 seconds.
- Edge cases:
  - Nudging down should not go negative.
  - Nudging should preserve paused vs running state.

### Auto-start toggle

- Auto-start OFF: when a phase ends, the next phase should not automatically start.
- Auto-start ON: when a phase ends, the next phase should automatically start.

## Mobile

### Tap targets + layout

- Buttons are easy to tap; no accidental mis-taps.
- No important controls off-screen on small devices.
- Orientation change doesn’t break layout.

### Wake lock / sleep behavior

- Start a focus session; let the phone idle.
- Returning to the app should show an accurate remaining time (timestamp-based catch-up).

## Notifications

### Permission flow

- First-time permission prompt behaves reasonably.
- If denied, app still works and does not repeatedly spam prompts.

### Fires at phase end

- Notification shown when a phase completes (focus and break).

## Sound

- Chime toggle: plays (ON) / silent (OFF) at phase end.
- Tick toggle: ticking while running (ON) / no ticking (OFF).
- Tick volume changes loudness; mute = silence.

## Long breaks

- “Long break every N focus sessions”: verify the Nth completion yields a long break.
- Verify the counter resets appropriately after a long break.

## Share card

- Open share UI; card renders (not blank).
- Copy/save works.

## Offline

- Load once, then airplane mode.
- If a service worker is present: refresh should still load.
- If no service worker: note that full offline refresh is not supported, but in-page timer should continue.

## Local stats

- Streak increments only after a completed focus session.
- Clear stats wipes stored data; reload confirms.
