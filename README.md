# Forest Contract Calculator

KC-linked contract quoting for Forest Coffee. Built from the *Forest Spot Contracts Process*
sheet, which it reproduces to the cent and then extends with a margin ladder, a two-way
margin/price solver, live FX, and an audited admin module.

## What it does

Every price is assembled per pound in US dollars, the unit the Coffee "C" (KC) contract trades in:

```
green coffee   = KC month price + quality premium
differential   = packaging + milling + transport + port + freight + margin-bearing fixed lines
                 (+ ocean freight from CIF, + import and unloading at DDP, + storage if carried)
finance        = monthly rate x months x (green coffee + differential)
break-even     = green coffee + differential + finance
selling price  = break-even grossed up by the margin
```

- **Price ladder** — every quote is priced at the 16% floor and across 20–30% in one-point steps,
  in USD/lb, US cents/lb, the client's own currency and unit, and total contract value.
- **Projected KC** — type a scenario price ("what if KC goes to 220?") and the whole ladder moves.
  The field is flagged whenever it differs from the desk's figure.
- **Two-way solver** — name a margin and get the price, or name the price the client is pushing for
  and get the margin it leaves, flagged when it falls under the floor or under cost.
- **Per-destination units** — US destinations quote in USD/lb; Canada, Rotterdam, the UK, Australia
  and Dubai quote in their own currency per kilo. Configurable per destination.
- **Audited quote history** — a saved quote stamps the KC price, the premium, every exchange rate
  and the entire cost table as they stood, so any number can be explained months later.

## Getting started

```bash
npm install
cp .env.example .env.local     # set ADMIN_PASSWORD and SESSION_SECRET
npm run seed                   # loads the sheet's cost tables (also runs automatically on first boot)
npm run dev
```

`SESSION_SECRET` has no default on purpose — without it, admin sign-in is disabled rather than
falling back to something guessable. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Engine tests, including reconciliation against the source sheet |
| `npm run seed` | Re-seed reference data (never overwrites KC prices, premiums or pinned FX) |

## Who can do what

Anyone with the URL can build and save quotes. Editing the cost tables, monthly premiums, KC prices
and FX needs the admin password. Every admin change is written to the audit log with who and when.

## Data sources

| Input | Source |
| --- | --- |
| KC futures by contract month | Entered by hand in Admin. The full forward curve needs a licensed feed, so the desk types it. |
| Quality premium by month | Entered by hand in Admin. |
| TRM (USD/COP) | Banco de la República, via `datos.gov.co`. |
| EUR, GBP, AUD, CAD | ECB reference rates, via `api.frankfurter.app`. |

Both FX sources are fetched on demand from Admin. A failed fetch reports the error and leaves the
stored rates untouched — it never zeroes a rate or half-applies an update. Any rate can be **pinned**
to a manual value, which the fetch will never overwrite; use this to quote against a booked forward
rather than spot. TRM is entered the way a trader says it, pesos per dollar.

Both hosts must be reachable from wherever the app is deployed.

## What the sheet said, and what changed

The engine reproduces the sheet's FOB differential of **$0.5641/lb** for washed coffee in 70 kg bags
at TRM 3,150, line for line, and every destination's DDP differential. Three deliberate changes:

1. **Finance is charged on the full cargo value.** The sheet applied 0.72%/month to the $0.564 cost
   stack alone, ignoring the coffee — roughly 75% of what is actually financed. It now applies to
   green coffee plus the differential, which makes the line about four times larger. `Admin →
   Pricing policy` can be set back if you need to match historic quotes.
2. **Margin is explicit.** The sheet had no margin step. Margin defaults to a share of the selling
   price (gross margin) charged on full landed cost. Both of those are settings: margin can be a
   markup on cost instead, and can be charged on the differential only, leaving the coffee at cost.
3. **Zeroes warn instead of pricing silently.** Dubai has no storage rate and no destination has an
   unloading cost in the sheet. Rather than quietly quoting those at nothing, the calculator says so.

## Open items

- **Unloading (DDP)** is zero for every destination — the sheet never filled it in.
- **Dubai storage** has no rate.
- **35 kg packaging at 24,843 COP** is 2.7x the cost of a 70 kg bag for half the volume. Plausible
  for a vacuum or box pack, but worth confirming against an invoice.
- **GMF** is modelled as a flat 3.19 COP/lb, as in the sheet, not as 0.4% of peso flows.
- **Partial containers** warn rather than reprice: per-pound freight, port and inland transport all
  assume a full load, so a half container understates them.
- **Quality tiers.** Premiums are stored per month with a `quality_key` column already in place, but
  only a single `standard` tier is exposed. Adding 84+/86+ tiers needs no migration.

## Layout

```
src/lib/pricing/    engine.ts (pure, tested), types.ts, units.ts, reference.ts (the sheet)
src/lib/db/         schema.sql, accessors, seed
src/lib/            kc.ts (contract months), fx.ts, auth.ts, format.ts
src/app/            quote screen, /admin, /quotes, server actions
src/components/     QuoteBuilder and admin form helpers
```

The pricing engine is pure TypeScript with no I/O, so the browser recalculates instantly on every
keystroke while the server recomputes the same numbers when a quote is saved — the browser's figures
are never trusted.

## Deployment

State lives in SQLite at `data/calculator.db` (override with `DATABASE_PATH`). That needs a
persistent disk, so a long-running Node host or container suits it; a serverless platform with an
ephemeral filesystem would lose the quote history and any rate edits between invocations.
