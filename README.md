# outmatch.lol

A browser editor that places your message and name behind the transparent hamster and exports a 1080p WebM with sound. The clean clip removes the source video's white opening flash and baked closing words. Cloudflare Durable Object storage powers the persistent today and total visit counters.

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
