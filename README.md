# Dino Book Factory

A mobile-first web app that builds an Amazon KDP paperback coloring book, *Dino Buddies Coloring Book*, from your phone. It produces two files: an 8.5" × 11" black-and-white interior PDF and a full-wrap cover PDF. Both are checked against KDP's rules before they are saved. Nothing is ever uploaded to Amazon automatically.

## Status

| Feature | Status |
|---|---|
| KDP interior template: 8.5 × 11, no bleed, mirrored gutter | Done and tested |
| Page order: title, copyright, "This Book Belongs To", blank, then 30 × (illustration on the right-hand page + blank back) = **64 pages** | Done and tested |
| Margin and gutter rules by page count (KDP chart) | Done and tested |
| Full-wrap cover: bleed, back, spine, front, safe zones, 2" × 1.2" barcode area | Done and tested |
| Spine width from KDP's white-paper formula; spine text only at 80+ pages | Done and tested |
| PDF validation: page sizes, page count, page order, margins, 300 DPI, embedded fonts, cover size, barcode area kept clear | Done and tested |
| Review gallery: approve, reject, regenerate, upload, edit prompt | Done and tested with uploads |
| Rejected images can never reach a PDF (moved out of the book folder, and checked again at export) | Done and tested |
| Final interior and cover assembled automatically once all 30 are approved | Done and tested |
| PDFs download from iPhone Safari (sent as attachments) | Done |
| Book title, subtitle, back-cover description, 7 keywords (editable) | Done |
| AI image generation through Replicate or OpenAI | **Written, not yet tested with a live key** |
| Hosting | **Needs your Render account (steps below)** |

## KDP numbers for this book

- Interior: 64 pages, 8.5" × 11", no bleed. KDP accepts 24–828 pages for this trim on white paper.
- Gutter: 0.625" used. KDP's minimum for 24–150 pages is 0.375".
- Outside, top and bottom margins: 0.5" used. KDP's minimum without bleed is 0.25".
- Artwork area: 7.375" × 10". Images are prepared at 2250 × 3000 px, which places at about 305 DPI.
- Spine: 64 × 0.002252" = **0.1441"**.
- Full cover: 0.125 + 8.5 + 0.1441 + 8.5 + 0.125 = **17.3941" × 11.25"**.
- Spine text: none. KDP's cover guide says 79+ pages are needed and Cover Creator says 80, so the app enforces 80.

The spine uses the same per-page formula as KDP's calculator. Still, before you upload, enter 8.5 × 11, white paper, black ink and 64 pages in the [official cover calculator](https://kdp.amazon.com/cover-calculator) and confirm the numbers match.

Sources: [Set Trim Size, Bleed, and Margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6) · [Create a Paperback Cover](https://kdp.amazon.com/en_US/help/topic/G201953020) · [Cover Creator](https://kdp.amazon.com/en_US/help/topic/G201113520)

## Deploy from an iPhone (Render)

1. Sign in at render.com with GitHub, then tap **New → Blueprint** and choose this repository. `render.yaml` sets everything up, including a 1 GB persistent disk. The disk needs the Starter plan, about $7/month plus $0.25/GB.
2. When asked for environment variables, fill in:
   - `APP_PASSWORD`: a long password. Safari asks for it when you open the app; the username can be anything.
   - `REPLICATE_API_TOKEN`: from replicate.com → Account → API tokens. FLUX schnell costs a fraction of a cent per image. To use OpenAI instead, set `IMAGE_PROVIDER=openai` and `OPENAI_API_KEY`.
3. Open the `*.onrender.com` link in Safari. Optional: Share → Add to Home Screen.

API keys live only in the server's environment variables. The browser never sees them.

## Workflow

1. **Book tab:** enter your author name, which the final files require, and adjust the title, description and keywords.
2. **Pages tab:** tap Generate, or upload your own line art. Every image is converted to pure black and white at 2250 × 3000 px. Then approve, reject or regenerate each one.
3. **Export tab:** build proofs at any time. Placeholders fill pages that are not approved yet, and proofs are not for upload. The print-ready interior unlocks once all 30 are approved, and is built automatically at that moment.
4. Download, check the PDFs, then upload them to KDP yourself. KDP asks whether the book contains AI-generated content, so answer that honestly.

## Run locally / test

```
npm install
npm test        # builds proof + final PDFs in a temp folder and validates them
npm start       # http://localhost:3000
```

Stack: Node 20+, Express, pdf-lib (MIT), sharp (Apache-2.0), Fredoka and Nunito fonts (OFL, embedded in every PDF).
