# outmatch.lol

A minimal browser editor that places animated text behind the supplied transparent hamster clip and exports a 1080p WebM with the original audio. Cloudflare Durable Object storage powers the persistent live-today and total-visit counters.

## Run

```powershell
npm run dev
```

Then open `http://127.0.0.1:4173` in Chrome, Edge, or Firefox. Video export uses the browser's `MediaRecorder` API.

## Cloudflare

```powershell
npm run dev:cloudflare
npm run deploy
```

The Worker serves the static app, stores counters in a SQLite-backed Durable Object, streams live updates over WebSockets, and maps to `outmatch.lol` as a Cloudflare custom domain.
