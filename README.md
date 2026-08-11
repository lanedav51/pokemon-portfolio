# Card Portfolio

A mobile-friendly web app for cataloging a Pokemon card collection: photograph a
card, OCR pulls the name/number off it, you confirm the exact card against the
[pokemontcg.io](https://pokemontcg.io) database, current market price comes
along for free, and the whole thing gets appended as a row in a Google Sheet.

## How it works

1. **`/add`** — take/upload a photo (uses the phone camera via the browser).
   The photo is sent to Google Cloud Vision for OCR, never stored — it's only
   used to pre-fill a search.
2. The guessed name/number are used to search pokemontcg.io. You pick the
   correct card from the results (with images), fixing any OCR mistakes.
3. Set condition, quantity, price (pre-filled with the live market price),
   and optional notes, then save. This appends one row to your Google Sheet.
4. **`/`** — the portfolio view reads the sheet back and shows total value,
   card count, and the full list.

## Google Cloud setup

You need one Google Cloud project with two APIs enabled, and one service
account shared with your Sheet.

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable **Google Sheets API** and **Cloud Vision API** for that project
   (APIs & Services → Enable APIs and Services).
3. Create a **service account** (IAM & Admin → Service Accounts → Create).
   No special roles are required — API access is granted per-resource.
4. Open the service account → Keys → Add Key → Create new key → JSON.
   Download it.
5. From the downloaded JSON, copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (keep the `\n`
     sequences as-is, wrap the whole value in quotes)
6. Create a new Google Sheet. Click **Share** and add the service account's
   `client_email` as an **Editor**. (It's a real email-shaped address — share
   it like you'd share with a person.)
7. Copy the sheet ID out of its URL:
   `https://docs.google.com/spreadsheets/d/THIS_PART/edit` → `GOOGLE_SHEET_ID`.
   Leave the sheet's first tab named `Portfolio` (or rename it to that) —
   the app writes a header row automatically the first time it runs.
8. Optional: grab a free API key from [dev.pokemontcg.io](https://dev.pokemontcg.io/)
   and set `POKEMONTCG_API_KEY` to raise the card-search rate limit from
   20/min to 20,000/day. Works without one for personal use.

Copy `.env.example` to `.env.local` and fill in the values above.

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Camera capture works in
most mobile browsers even over `http://localhost`, but for testing on an
actual phone you'll need HTTPS (see deployment below) — most browsers block
camera access on a plain HTTP origin other than localhost.

## Deploying (so you can use it from your phone)

### Netlify

1. Push this repo to GitHub (the `origin` remote is already configured).
2. On [app.netlify.com](https://app.netlify.com), **Add new site → Import an
   existing project**, pick this repo. Netlify auto-detects Next.js — the
   build command and Next.js runtime plugin are handled automatically;
   `netlify.toml` in this repo just pins the Node version.
3. Before the first deploy (or right after, then redeploy), add the four env
   vars from `.env.local` under **Site configuration → Environment
   variables**. Paste `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` exactly as it
   appears in `.env.local`, `\n` sequences and all.
4. Deploy. Netlify gives you an HTTPS `https://<site-name>.netlify.app` URL.
5. Open that URL on your phone and add it to your home screen (Share → Add
   to Home Screen on iOS, or the install prompt on Android) — it's a PWA, so
   it opens full-screen like a native app.

### Vercel (alternative)

Same shape: push to GitHub, import at [vercel.com/new](https://vercel.com/new),
add the same four env vars in the project settings, deploy.

## Notes on price data

Prices come from whichever of TCGPlayer market price or Cardmarket trend
price pokemontcg.io has for that card — TCGPlayer (USD) is preferred when
available. Prices update however often pokemontcg.io refreshes (typically
daily), and the price shown when you add a card is a snapshot saved into the
sheet, not a live link — rescanning the same card later will save an updated
price as a new row.
