# cutu.lol

A browser based Baby Boo hamster meme maker. Add text, preview it over the looping hamster clip, then download a video with sound or a silent looping GIF. You can also share a link that opens with your text. The visitor counters count each browser once per day and once overall, using a one-year visitor cookie and a Cloudflare Durable Object.

Copied links include the text in a generated 1200 × 630 PNG preview card. The server adds matching Open Graph and Twitter metadata to each shared URL so messaging and social platforms can display the card. The card template uses the Baby Boo stamp and the bundled Lora font (see `site/share-font-LICENSE.txt`).

## Run

```powershell
npm run dev
```

Then open `http://127.0.0.1:4173` in a modern browser. The **Download** menu offers Video and GIF. During export, the main button shows progress around its outline and the menu stays closed. When the file is ready, that button briefly becomes **Save video** or **Save GIF** before returning to the menu. Video export uses the browser's `MediaRecorder` API. It prefers MP4 and falls back to WebM when MP4 recording is unavailable. GIF export uses the bundled MIT-licensed `gifenc` encoder and has no sound. Export uses a lighter resolution on touch devices to keep playback smooth. On mobile, tap the save button after rendering to start the browser's native download. Desktop browsers start the download when rendering finishes. Mobile sharing uses the system share sheet: it shares the rendered video file when supported, or a link containing the text before export.

## Cloudflare

```powershell
npm run dev:cloudflare
npm run deploy
```

The editable website lives in `site/`. The local server serves that directory directly. `npm run prepare:public` rebuilds the ignored `public/` deployment directory from it. `npm run deploy` checks the JavaScript, prepares the assets, and deploys with the locally authenticated Wrangler account. The Worker stores visitor counts in a SQLite-backed Durable Object and maps to `cutu.suryansh.lol` as a Cloudflare custom domain.

Pushes to `master` deploy through GitHub Actions. The repository needs `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` in GitHub Actions secrets. The deployment token is scoped to Editor for the existing `outmatch` Worker and Workers Routes Write for the `suryansh.lol` zone. Renew the token before its October 2027 expiration.

Google Search Console verification, Google Analytics (`G-B04H26G5QT`), and Microsoft Clarity (`yqga817oq9`) are installed in `site/index.html`. The Search Console sitemap is at `/sitemap.xml`.
