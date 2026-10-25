# Drip Trace — Our app. Your share. Life-changing prizes.

> **GitHub Pages:** `index.html` at the repo root is an overview page with screenshots (demo data). The real app is the Node.js server (`server.js`) plus the front end in `public/`; it needs the server to run, so it isn't live on Pages. No database, uploads, logs, `.env` or API keys are included; copy `.env.example` (where present) and add your own.
At every fill-up, drivers say whether the pump dripped: no drip, a drop, a few drops, a puddle, overflow, or a nozzle leak. **A drip is an equipment or station issue, never the driver's fault.** The report takes about 10 seconds: the nearest station is picked automatically from GPS, you enter the pump number, choose the size, and snap the nozzle. Grok vision checks the photo, which is then thrown away. "No drip" reports matter as much as drips, because they're needed to calculate drip rates.

It's a sister app to Butt Trace with the same stack: Node/Express, SQLite (sql.js), and a vanilla JS PWA. It runs on port 8788.

## Run
```
npm install
ADMIN_TOKEN=demo-admin PORT=8788 node server.js   # http://localhost:8788
```
- **Stations:** 428 real gas stations (`amenity=fuel`) from OpenStreetMap via Overpass, covering Chattanooga TN and North GA (bbox 34.4,-85.7 to 35.3,-84.6). They're in `stations.json`, and 284 of them have a brand. © OpenStreetMap contributors (ODbL): keep that attribution on the Desk and in data products.
- **Demo data:** 2,500 synthetic reports on those real stations, with engine=`demo`, never paid and never entered in draws. Everything built from them is labeled DEMO. **They are not real findings about any station or brand.** Remove them before showing data to buyers.

## Pages
`#` landing (pot progress, transparency, this week) · `#report` (the fast flow) · `#me` (draw entry, **Your stake**, daily question, prize vote, reports) · `#desk` (buyers) · `#ask` (sponsored questions) · `#live` (Facebook Live draw) · `#audit` · `#admin` · `#rules` `#terms` `#privacy` `#agreement`.

## Anti-fraud
- You must be **within 75 m** of the station.
- **One report per user per station every 4 hours**, and 3 reports per 10 minutes at most.
- Duplicate photos are rejected (perceptual hash, 14-day window). GPS and a photo are required.
- Phone verification, with one account per phone number and one per Stripe payout account (bank fingerprint).
- Auto-flags: mock engine, not a pump photo, photo disagrees with the chosen size, low confidence, GPS accuracy worse than 50 m.
- Clean Grok results are auto-verified. Everything else goes to the admin review queue.

## Money: 70% to members, 30% to operator
- **Net revenue** = buyer payments − Stripe fee (estimated at 2.9% + $0.30). That covers sell-sheet sales, subscriptions, and sponsored questions.
- **Members' 70%**, split by `pot_pct` (default 50/50):
  - **Weekly prize pot:** a live progress bar toward the **$30,000 goal**. Weekly prizes are paid from it, unless a sponsor pays for the prize.
  - **Monthly member share:** distributed by **member points**: +10 per verified report, +2 per daily-question answer. Run it from the Admin button. The amount becomes withdrawable through Stripe Connect.
- **Optional per-report pay** (off by default): $0.05 a report, $0.50/day cap, paid out of the members' share.
- **Operator's 30%** pays for hosting, Grok, SMS and Stripe Connect fees.
- **Example:** $10,000 a month in sales nets about $9,700. Members get $6,790 ($3,395 to the pot and $3,395 split by points), and the operator keeps $2,910. At that rate the pot reaches $30k in about 9 months, if weekly $100 prizes are sponsored.

### "Member-owned" — what it is and isn't
"Your stake" is your share of points for **this month's member distribution**. **It is not equity, stock, a security, or an investment.** It carries no ownership, voting or profit rights, and every page that mentions it says so. **Giving users real ownership** would require a cooperative (for example a Georgia cooperative or LLC with member units) or a Regulation Crowdfunding (Reg CF) offering through a registered funding portal. **Both need a securities lawyer.** Avoid words like "invest", "shares" or "returns" in marketing until then.

## Weekly live draw (built for Facebook Live)
- One entry per person per week, from at least one verified report or the free entry (Me page or by mail). Past winners stay eligible.
- **Prize:** members vote from 3 admin-set options, and the top option becomes next week's prize. There's a fallback prize and an optional sponsor slot.
- **`#live` page:** big, high-contrast, built for streaming. The operator publishes the commitment (SHA-256 of a secret 256-bit seed), then last week's winner presses **PICK**. Winner = HMAC-SHA256(seed, sorted entry IDs) mod N. The shuffle animation is only for show. The seed, entries list and hash are logged on `#audit` so anyone can recompute the result. Entries are masked on screen (wa•••t).
- The draw run in week N covers entries from week N−1.

## Daily Question (optional, written by the operator)
- Walt writes and schedules questions in Admin. Answering is never required for entries. Answers earn +2 points.
- Desk shows anonymous aggregates of operator questions.
- **Sponsored Questions** (`#ask`): a business or researcher pays **$250/day** (adjustable) through Stripe Checkout. The operator approves the question before it runs. Questions asking for personal or identifying information are blocked automatically. The sponsor gets a private link (`/sq/<key>`) to anonymous aggregate results, shown only once 10+ members have answered.

## Buyer Desk
Desk shows a brand drip-rate leaderboard, a station map, weekly trend, highest drip-rate stations, per-pump stats, survey aggregates, a free sample report (`/sample-report`), and a quote form (leads go to Admin). The sell sheet, with Stripe Checkout (prices are suggestions):

| Product | Price |
|---|---|
| Station-chain maintenance alerts | $4,800/chain/yr |
| Insurer station-risk index | $18,000/yr |
| Environmental spill-watch | $9,500/county/yr |
| Law firm / NGO evidence pack | $2,500/report |
| Fuel-equipment nozzle failure census | $24,000/yr |
| Investor ops-quality index | $12,000/yr |
| Local Starter | $49/mo |
| Sponsored daily question | $250/day |

API: `/api/v1/export.csv?key=dt_...`. The key is sent automatically after payment, or you can issue one in Admin.

## Deploy
Render Blueprint (`render.yaml`: Docker, 1 GB disk, /healthz), or `docker build -t drip-trace . && docker run -p 8080:8080 -v dt:/data --env-file .env drip-trace`. HTTPS is required for the camera and GPS. Backups run every 6 hours to `backups/`, keeping the last 28.

## Keys and accounts you have to supply
- **xAI API key** (`XAI_API_KEY`). Without it, all reports are mock and need review.
- **Stripe** (`STRIPE_SECRET_KEY`, starting with `sk_test_`), plus Connect Express turned on and a webhook (`STRIPE_WEBHOOK_SECRET`).
- **Twilio Verify** for SMS. Until then codes show on screen.
- An `ADMIN_TOKEN`, a host plus domain (`BASE_URL`), and `OPERATOR_EMAIL`. Optionally an email provider; for now email is a stub that writes to the Admin Outbox.
- A **Facebook Page** for the live draws. Facebook's promotion rules say you may not require shares or tags to enter, and you need a release saying Facebook isn't involved. The rules page covers entry; add the FB release line to the post.

## Legal notes (templates, not legal advice)
- Sweepstakes: the rules page includes no purchase necessary, a free AMOE, 18+, US only, and void where prohibited.
- **Any single prize over $5,000 requires NY and FL registration and bonding, or excluding those states.** A $30k grand prize triggers this, so plan for it. Prizes worth $600+ a year to one person need a W-9 and 1099-MISC.
- Data about stations is member-observed. Label it that way and never call it a "violation".
- Stations may object. Keep the language factual ("reported drip rate"). Consider letting a station respond before naming it in paid reports.
- Safety: tell members to photograph only after fueling.


Created by Walter Henderson Jr.
