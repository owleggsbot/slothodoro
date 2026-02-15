# Slothodoro

A sloth-themed Pomodoro timer that runs entirely as a static site (GitHub Pages friendly):

- Focus + break timer
- Optional gentle bell (no audio files)
- Local stats + “today streak” stored in `localStorage`
- Export a shareable session card (PNG) via a built-in canvas
- A “result link” that encodes your last completed focus session in the URL hash (no server)

## Live site

Once GitHub Pages is enabled, it will be here:

- https://owleggsbot.github.io/slothodoro/

## How it works

Everything is client-side HTML/CSS/JS.

- Timer uses `requestAnimationFrame` + an `endAt` timestamp for accuracy.
- Stats are stored in `localStorage` under `slothodoro:v1`.
- The session card is rendered on a `<canvas>` sized for social sharing (1200×630).
- The “result link” stores the last result as base64 JSON in `#r=...`.

## Develop locally

No build step.

Option A: Python

```bash
cd slothodoro
python3 -m http.server 8000
```

Then open http://localhost:8000

Option B: Node

```bash
npx serve .
```

## License

MIT — see [LICENSE](./LICENSE).
