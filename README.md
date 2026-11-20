# KDP Coloring Book Factory

A mobile-first web app that builds an Amazon KDP paperback coloring book, *Dino Buddies Coloring Book*, from your phone. It produces two files: an 8.5" × 11" black-and-white interior PDF and a full-wrap cover PDF. Both are checked against KDP's rules before they are saved. Nothing is ever uploaded to Amazon, and nothing is deployed or purchased automatically.

## Multi-book library

The app manages any number of independent coloring books. Each one has its own title, theme, illustration count, uploads, approvals, cover art, metadata and PDFs.

- **Books tab:** create, open, rename, duplicate (copies artwork and approvals, not PDFs) and archive. Archiving hides a book; nothing is ever deleted.
- **New book:** pick 20, 30, 50, 75, 100 or 150 illustrations, or type any number. Then choose the trim size (8.5 × 11, 8 × 10 or 8.5 × 8.5) and the paper (white or cream). The form shows the printed page count, spine and cover size live, and refuses counts above KDP's page limit.
- **Illustrations vs printed pages:** each illustration takes 2 printed pages, the picture on a right-hand page plus a blank back. Front matter adds 2 pages (title and copyright), or 4 with the "This Book Belongs To" page. So 30 illustrations make 64 pages, and 100 illustrations make 204.
- **Calculated per book from its real page count:** the inside margin, raised automatically to KDP's minimum (0.375" up to 150 pages, 0.5" up to 300, 0.625" up to 500, 0.75" up to 700, 0.875" above that); the spine (pages × 0.002252" on white, × 0.0025" on cream); the cover size; and whether spine text is allowed (80+ pages).
- **KDP page limits for black ink** (from KDP's submission guidelines): 8.5 × 11 and 8.5 × 8.5 allow 24–590 pages on white or 24–550 on cream, which is at most 293 illustrations on 8.5 × 11 white. 8 × 10 allows 24–828 on white or 24–776 on cream.
- **Changing the count later:** adding illustrations is always safe. Removing them only drops empty pages at the end; pages with artwork or history are never removed.
- **Migration:** the original single-book data was copied into the library as "Dino Buddies Coloring Book" on first start. The original files stay untouched in `DATA_DIR` as a backup, and the migration is recorded in `library.json`.

### Large books on Render Free (measured)

Measured on a full CPU, with estimates for Render Free's 0.1 CPU:

| Illustrations | Printed pages | Final interior PDF | CPU time (estimate on 0.1 CPU) | Peak memory |
|---|---|---|---|---|
| 30 | 64 | ~1.5 MB | ~10 s (~1.5 min) | ~260 MB |
| 100 | 204 | ~5.5 MB | ~30 s (~5 min) | ~270 MB |
| 150 | 304 | ~8 MB | ~45 s (~7.5 min) | ~275 MB |

- **Background builds:** PDFs build in the background, one at a time, and the app shows progress, so a long build never ties up a page or a tap.
- **Uploads** take about 7 seconds each on the free plan, so a 150-illustration book means a long upload session.
- **Storage:** a 150-illustration book uses roughly 20–40 MB in the bucket, far under the 10 GB free tier.
- **Wake-ups:** each one downloads only the small JSON files. Images and PDFs are fetched when first needed.

## Status

| Feature | Status |
|---|---|
| KDP interior template: 8.5 × 11, no bleed, mirrored gutter, 64 pages | Done and tested |
| Full-wrap cover: bleed, spine, safe zones, barcode area; spine 0.1441" | Done and tested |
| PDF validation: sizes, page order, margins, 300 DPI, embedded fonts, cover size | Done and tested |
| Review gallery: approve, reject, regenerate, upload, edit prompt, "Generate all missing" | Done and tested |
| Rejected images can never reach a PDF (kept in `rejected/`, never deleted) | Done and tested |
| Final interior and cover built automatically once all 30 are approved | Done and tested |
| Server-side configuration: `APP_PASSWORD`, `IMAGE_PROVIDER`, API keys | Done and tested. No keys in the browser or `localStorage` |
| App refuses to start in production without `APP_PASSWORD`; lockout after 10 wrong passwords | Done and tested |
| Persistent storage: images, approvals, decision log, cover art and PDFs survive restarts and redeploys | Done and tested (local fake S3 + mirror folder) |
| Daily generation cap (`MAX_GENERATIONS_PER_DAY`, default 60) | Done and tested |
| **Built-in drawing engine (default, free, no API key)** | **Prototype: 3 of 30 page designs done** (#1 happy T-Rex, #2 Triceratops picnic, #4 baby Brachiosaurus garden) |
| Generate / Regenerate / Preview / Approve / Reject; Generate all drafts with progress | Done and tested |
| Approved pages can't be replaced or removed without a second "confirm" tap | Done and tested |
| Final export refuses blank or near-empty artwork (ink and gray check on every page) | Done and tested |
| Replicate and OpenAI generation (optional, paid) | Tested against mock APIs only. Not needed for the built-in engine |
| Cloudflare R2 storage | Tested with a local S3 emulator. **Not yet run against real R2** |
| Deployment on Render | **Not deployed. Waiting for your approval and accounts** |

## Built-in drawing engine (`src/engine/`)

The engine draws original dinosaur coloring pages from code. It needs no AI service, API key, credits or GPU, so it costs nothing.

- **How it draws:** every page is built from vector shapes and Bézier curves, then rendered by the existing sharp tooling to a 2250 × 3000 px PNG at 300 DPI, forced to pure black and white. The SVG source is saved next to each PNG.
- **Seeds:** each drawing comes from a seed. The same seed redraws the identical page, and Regenerate picks a new seed for a new variation (pose details, mood, scenery, prop positions).
- **Clean outlines:** body parts are single closed outlines. Bellies and spots are clipped inside the body. A white halo behind each dinosaur makes ground lines, hills and fences stop at the figure instead of crossing it. A layout manager keeps the sun, clouds, butterflies and flowers off the dinosaur and off each other.
- **Status:** 3 page designs exist so far, which is a prototype. Pages without a design say so in the app and can still use uploads.
- **Previews:** sample renders are in `samples/prototype-*.png`, regenerated by `npm test`.

## Image providers and costs

You pay the provider directly. The app never charges anything itself.

| `IMAGE_PROVIDER` | Model (default first) | Price per image | 30 pages + ~2× retries (~90 images) |
|---|---|---|---|
| *(empty)* or `svg` | Built-in drawing engine (default) | **$0** | **$0** |
| `replicate` | `black-forest-labs/flux-schnell` | about **$0.003** | about **$0.27** |
| `replicate` | `black-forest-labs/flux-dev` (set `REPLICATE_MODEL`) | about $0.025 | about $2.25 |
| `openai` | `gpt-image-2` | Billed per token: $15 per 1M image-output tokens. OpenAI's docs don't give a flat per-image price | Check OpenAI's pricing page |
| `openai` | `gpt-image-1.5` (deprecated) | $0.013 low / $0.05 medium / $0.20 high (1024×1536) | $1.17–$18 |

- **Recommendation:** start with Replicate FLUX schnell. It is the cheapest option, and every image is forced to pure black and white anyway. Switch to `flux-dev` if lines look rough.
- **gpt-image-1:** OpenAI shut it down on October 23, 2026, so it is not offered.
- **Billing:** both Replicate and OpenAI require you to add billing or prepaid credit before the API works.
- **Spending guard:** `MAX_GENERATIONS_PER_DAY` limits how many images can be generated per day, even if someone taps "Generate all missing" repeatedly.

Prices come from provider pages checked in November 2026 and change often. Confirm them on [replicate.com/pricing](https://replicate.com/pricing) and [OpenAI pricing](https://developers.openai.com/api/docs/pricing) before you add credit.

## Hosting and storage costs

| Option | What it costs | Notes |
|---|---|---|
| **Render Free + Cloudflare R2 (default in `render.yaml`)** | **$0** within free limits | The service sleeps after 15 minutes idle; the first visit then takes about a minute. R2's free tier covers 10 GB of storage and 1M write operations a month, with no download fees. Cloudflare asks for a payment method to turn R2 on. |
| Render Starter + persistent disk | $7/month + $0.25/GB/month | Always on, no bucket needed. **Only switch if you approve the cost.** |

This book needs well under 1 GB: about 30–90 line-art PNGs plus a few PDFs.

## How storage persistence works

The app works on files in `DATA_DIR`. With `STORAGE_BACKEND=s3`:

- **Writes:** every change is copied to your bucket right away: `state.json` (approvals, prompts, book details, decision log), `images/`, `rejected/`, `cover/` and `exports/`.
- **Startup:** the bucket is downloaded before the app accepts requests, so a fresh container after a redeploy gets everything back.
- **Shutdown:** when Render stops the app, it first finishes any pending uploads.
- **Approved files:** if an approved file were ever missing, that page is shown as "failed" instead of silently counting as approved.

With `STORAGE_BACKEND=local`, `DATA_DIR` must sit on a persistent disk (the paid option above).

## Deploy from your iPhone (Render Free + Backblaze B2, $0)

You do every step in Safari. None of them needs a credit card, and manual uploads need no image API.

**1. Free storage bucket (Backblaze B2: 10 GB free, no card at sign-up)**
1. Sign up at backblaze.com and choose **B2 Cloud Storage**.
2. Go to **Buckets → Create a Bucket**. Pick a unique name (for example `dino-book-yourname-2026`), set it to **Private** and turn encryption on.
3. Note the bucket's **Endpoint**, for example `s3.us-east-005.backblazeb2.com`. The region is the part in the middle, `us-east-005`.
4. Go to **Application Keys → Add a New Application Key**. Allow access to that bucket only, with **Read and Write**. Copy the **keyID** and the **applicationKey** right away; the key is shown only once.

**2. Render (Free plan)**
1. Sign up at render.com with GitHub and allow access to the `kids-coloring-book-` repository.
2. Tap **New → Blueprint**, pick the repository and the branch `claude/storyforge-mobile-app-62wmq5`. Render reads `render.yaml` and shows one **Free** web service.
3. Fill in the values it asks for:
   - `APP_PASSWORD`: a long password. Safari asks for it each session; the username can be anything.
   - `S3_ENDPOINT`: `https://` followed by the endpoint from step 1.3.
   - `S3_REGION`: for example `us-east-005`.
   - `S3_BUCKET`: your bucket's exact name.
   - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`: the keyID and applicationKey from step 1.4.
4. Check that the plan says **Free**. If Render asks for a card, stop: it usually means a service isn't on the free plan.
5. Tap **Apply**. The first build takes about 3–5 minutes.

**3. Use it**
1. Open `https://dino-book-factory-xxxx.onrender.com` and enter your password.
2. On **Overview**, the Storage card should say *Cloud bucket* and *All changes saved*.
3. Optional: Share → **Add to Home Screen**.

**If something is missing,** the app refuses to start rather than risk losing your work. Render's **Logs** tab shows the exact reason, such as `Refusing to start: ... needs S3_BUCKET`.

### Free-tier limitations

- **Sleep:** the service sleeps after 15 minutes without visits. The next visit takes about a minute while it wakes and reloads your work from the bucket.
- **Speed:** Render Free has 0.1 CPU and 512 MB RAM. Measured on a full machine and scaled down, expect about 7 seconds per upload, 1–2 minutes for the final 30-page interior, and about 15 seconds for the cover. The final build runs in the background after your 30th approval.
- **Monthly hours:** 750 free instance hours a month. If they run out, Render pauses the service until the next month.
- **Storage:** the server's own disk is erased on every restart; only the bucket keeps your work. B2's free tier covers 10 GB of storage and 2,500 downloads a day. Each wake-up downloads only what the app needs (rejected images and drawing sources stay in the bucket), which is well within the limit for this book.
- **Updates:** `autoDeploy` is off, so pushing to the branch doesn't redeploy. Use **Manual Deploy** in Render when you want an update.
- **Cloudflare R2** also works (`S3_REGION=auto`), but Cloudflare may ask for a payment method first.

### Uploading illustrations made in ChatGPT

Tap **Pages → Upload** on a page and pick the image from Photos or Files. ChatGPT portrait images are usually 1024 × 1536 px. The app enlarges them to print size (2250 × 3000) and converts them to pure black and white. Each card warns that the source is low resolution and adds narrow white side bands, because the book page is 3:4 rather than 2:3, so check the preview before approving. Ask ChatGPT for black outlines only, white background, no gray shading. Gray areas become solid black. When you publish, tell KDP the book contains AI-generated images.

## Workflow

1. **Book tab:** enter your author name (required for the final files) and adjust the title, description and keywords.
2. **Pages tab:** tap **Generate all missing**, or generate or upload one page at a time. Approve, reject or regenerate each image.
3. **Export tab:** proofs can be built at any time. The print-ready interior unlocks when all 30 are approved and is also built automatically at that moment.
4. Download the PDFs, check them, and upload them to KDP yourself. Before uploading, confirm the cover size (17.394" × 11.25" for 64 pages on white paper) in the [KDP cover calculator](https://kdp.amazon.com/cover-calculator). Answer KDP's AI-content question honestly.

## KDP numbers for this book

- **Interior:** 64 pages, 8.5" × 11", no bleed.
- **Gutter:** 0.625". KDP's minimum for 24–150 pages is 0.375".
- **Other margins:** 0.5". KDP's minimum is 0.25".
- **Art box:** 7.375" × 10". Images are prepared at 2250 × 3000 px (about 305 DPI), stored as native 1-bit black and white in the PDF.
- **Spine:** 64 × 0.002252" = 0.1441". The full cover is 17.3941" × 11.25". No spine text, because KDP needs 79–80+ pages for it.

Sources: [Set Trim Size, Bleed, and Margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) · [Create a Paperback Cover](https://kdp.amazon.com/en_US/help/topic/G201953020) · [Cover Creator](https://kdp.amazon.com/en_US/help/topic/G201113520)

## Configuration reference

See `.env.example`. Secrets are read only on the server (`src/config.js`). The browser receives just "configured: yes/no" and the variable names.

## Run locally / test

```
npm install
npm test     # PDF pipeline, persistence after a wiped container, auth/secrets, generation with mock providers
npm start    # http://localhost:3000
```

Stack: Node 22, Express, pdf-lib (MIT), sharp (Apache-2.0), AWS SDK v3 for S3/R2 (Apache-2.0), Fredoka and Nunito fonts (OFL, embedded in every PDF).
