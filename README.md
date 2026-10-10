# cutu.lol

A browser-based personalized meme maker. Choose a famous meme, add your text, then download a video with sound or a silent looping GIF. Baby Boo is selected by default at `/`. You can also share a link that opens with your text. The visitor counters count each browser once per day and once overall, using a one-year visitor cookie and a Cloudflare Durable Object.

Choose **Baby Boo** or **Speed** using the stamps beneath the preview. Speed uses the supplied transparent WebM, with your text behind the animation. Both stamps use the same playback, email intake, Video/GIF download, and sharing controls. Baby Boo supports sound; Speed hides the sound control and exports without an audio track. Switching back to Baby Boo restores the sound button. Shared Speed links include `stamp=speed` and generate a matching preview card; existing links still default to Baby Boo. Stamp selection is locked while an export is rendering. The picker uses equally sized, unlabeled stamps with accessible names and tooltips. Both videos and exports use Baby Boo?s 16:9 frame; Speed is contained at 70% scale and anchored to the bottom-left, with text on the right, while Baby Boo retains its original scale.

Copied links include the text in a generated 1200 × 630 PNG preview card. The server adds matching Open Graph and Twitter metadata to each shared URL so messaging and social platforms can display the card. Cards use the selected meme?s postage-stamp artwork and the bundled Lora font (see `site/share-font-LICENSE.txt`). Speed?s stamp matches Baby Boo?s aged-paper, engraved-ink style.

## Run

```powershell
npm run dev
```

Then open `http://127.0.0.1:4173` in a modern browser. **Download** opens a compact modal with the selected meme stamp, side-by-side **Video** and **GIF** choices, an outlined email field, and **Continue to download**. Video is selected by default. Choose a format and continue to save the email and start that export in one step. Selecting a format alone does not start rendering.

After successful intake, a completion flag in this browser skips the email field on future visits. No email address is kept in browser storage. If browser storage is unavailable, intake is remembered for the current page.

Export progress and the final save link stay inside the modal. Closing it allows rendering to finish; reopening shows the current state. On mobile, tap **Save video** or **Save GIF** after rendering to start a native download. Desktop browsers start the download when rendering finishes and also retain the save link. **Back** returns to the format picker without asking for email again.

Video export uses the browser's `MediaRecorder` API. It prefers MP4 and falls back to WebM when MP4 recording is unavailable. GIF export uses the bundled MIT-licensed `gifenc` encoder and has no sound. Export uses a lighter resolution on touch devices to keep playback smooth. Mobile sharing uses the system share sheet: it shares the rendered video file when supported, or a link containing the text before export.

### Email intake

`POST /api/email-intake` accepts JSON `{ "email": "you@example.com" }` and returns `{ "ok": true }` only after persistence. Addresses are trimmed, normalized to lowercase, and stored once with their creation timestamp. Invalid addresses or malformed JSON return 400; oversized requests return 413; unsupported content types return 415; unsupported methods return 405; cross-origin submissions return 403. Storage failures return 503 and can be retried. Responses contain no stored addresses and are not cached.

Production stores emails privately in the `EmailIntake` Durable Object, separately from visitor counters, using the `EMAIL_INTAKE` binding and the `v2` migration. Email listing requires an authenticated admin session. There is no outgoing email integration. The local Node server stores intake in ignored `.local-data/emails.json`; Cloudflare development uses Wrangler's local Durable Object storage. Do not commit these data files. The email form is masked for Clarity; email values are not added to analytics events, logs, or URLs.

Run `npm run check` for syntax checks across all JavaScript modules and the admin, intake/storage, metadata, sharing, PNG-rendering, and local HTTP tests. Verify browser behavior manually with both formats, including keyboard navigation, closing/reopening during export, stamp switching, sound, mobile layout, and mobile?s final save tap.

### Admin

Open `/admin` to sign in and view collected emails with collection dates, search across emails, and see visitor totals and Video/GIF download-request counts. The admin page has no analytics scripts and is marked noindex. Download counts begin with this update and measure export requests made through **Continue to download**, rather than confirmed file saves. Duplicate request IDs are counted once within 24 hours. Existing email records and visitor counters remain available.

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` as Cloudflare Worker secrets. Generate the salted password hash with the exported `hashAdminPassword` helper in `src/admin.js`; keep the password itself out of configuration files and Git. Upload the two secrets using `wrangler secret bulk` with an ignored JSON file. Copy `.env.example` to ignored `.env` for the local Node server, or use ignored `.dev.vars` for Wrangler development. No credentials have a source-code fallback.

Admin APIs live under `/api/admin/`: `POST login`, `GET session`, `GET dashboard?offset=0`, and `POST logout`. Login/logout require same-origin JSON requests. Login attempts are limited to eight per IP per 15 minutes. Sessions expire after eight hours, use HttpOnly/SameSite=Strict cookies (Secure over HTTPS), and are revoked on logout or credential changes. Protected responses are never cached. Dashboard pages contain at most 100 records; the admin UI loads all pages for local search. The private Durable Object stores sessions separately from email records and cleans expired authentication records and download request IDs daily once event tracking begins.

Local Node development uses in-memory sessions and download counters, and shows visitor counts as unavailable. Use Wrangler development to test persistent counters and Durable Object behavior. `POST /api/download-event` records a format and random request ID; it receives no email or password.


## Templates, SEO, and sharing

`site/memes.js` is the shared registry for browser playback, export filenames, artwork, defaults, descriptions, and URL helpers. Add template definitions there; the server renders the stamp picker from the registry. `site/app.js` coordinates selection and preview positioning; `text-layout.js`, `media.js`, `download-dialog.js`, and `sharing.js` own their respective behavior.

`src/json-body.js` reads bounded JSON streams for email intake and admin APIs, with each endpoint retaining its own byte limit and error messages. `src/download-events.js` validates download requests for both the local server and Durable Object; storage stays specific to each environment. Generated assets in `public/` are rebuilt from `site/` and are safe to replace; `.local-data/` and Wrangler storage contain persistent data and must be retained.

The homepage has general meme-maker metadata, WebSite/WebApplication structured data. `src/page-meta.js` supplies server-rendered titles, Open Graph/X metadata, structured data, and initial template content for both the Node server and Cloudflare Worker. Query variants use the homepage as their canonical URL; only the homepage belongs in the sitemap. Admin pages remain noindex.

Existing `/?text=...` and `/?stamp=speed&text=...` links continue to work. Unknown stamps default to Baby Boo. Text uses a shared 120 UTF-16-unit limit, preserving line breaks and complete emoji at the boundary. Empty text uses the selected template?s default. Personalized cards remain at `/share-card.png?text=...&stamp=speed`; new metadata includes a `v=2` artwork version to bypass old preview-image caches. Platforms may still cache previously shared page previews.

The Worker handles GET and HEAD page requests through the same renderer; HEAD does not increment visitor totals. Keep the durable object names, cookie names, and `hamster-sitewide` counter identity stable: they refer to existing data, rather than public branding.

To validate Cloudflare packaging without deploying:

```powershell
npm run prepare:public
npx wrangler deploy --dry-run
```

Speed artwork was edited with the built-in image-generation tool; see [artwork prompt](docs/stamp-artwork.md).

## Cloudflare

```powershell
npm run dev:cloudflare
npm run deploy
```

The editable website lives in `site/`. The local server serves that directory directly. `npm run prepare:public` rebuilds the ignored `public/` deployment directory from it. `npm run deploy` checks the JavaScript, prepares the assets, and deploys with the locally authenticated Wrangler account. The Worker stores visitor counts in a SQLite-backed Durable Object and maps to `cutu.suryansh.lol` as a Cloudflare custom domain.

Pushes to `master` deploy through GitHub Actions. The repository needs `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` in GitHub Actions secrets. The deployment token is scoped to Editor for the existing `outmatch` Worker and Workers Routes Write for the `suryansh.lol` zone. Renew the token before its October 2027 expiration.

Google Search Console verification, Google Analytics (`G-B04H26G5QT`), and Microsoft Clarity (`yqga817oq9`) are installed in `site/index.html`. The Search Console sitemap is at `/sitemap.xml`.
