# Forest Quote Desk

KC-linked contract quoting for Forest Coffee. Built from the *Forest Spot Contracts Process*
sheet, dressed in the Forest Design System, and extended with a price ladder, three solvers, a
delivery calendar and a client-ready quote sheet.

## How a price is built

Everything is assembled per pound in US dollars — the unit KC trades in — and converted to the
client's own currency and unit at the very end.

```
green coffee  = KC + quality premium
differential  = packaging + milling + transport + port + freight + fixed cost
                (+ ocean freight from CIF, + import and unloading at DDP,
                 + storage while we carry it — DDP only)
finance       = monthly rate x billed months x (green coffee + differential)   DDP only
break-even    = green coffee + differential + finance
selling price = break-even grossed up by the margin, rounded up to two decimals
```

**The quoted price is rounded first, and everything else derives from it** — contract value, cents
per pound, margin. A client multiplies the price by the quantity, so the two have to agree.

## What the screens do

**Quote** — one KC field with a *Latest* button, the shipment window, how long the contract is
held, then the terms. Produces the price at the 16% floor and across 16 / 20 / 22.5 / 25 / 30%,
with the step up between rungs. Three solvers sit directly under the price:

| Solver | You give it | It tells you |
| --- | --- | --- |
| Margin → price | a margin | what to quote |
| Price → margin | the client's price | the margin it leaves |
| Price target → KC needed | a price *and* a margin | where KC has to be |

Below that, the delivery schedule: 250 bags from January to May is 50 bags a month, with the
monthly billing in the client's currency. Bags stay whole and the billing column adds up exactly
to the printed total.

**Multi-shipment** (admin) — one contract shipped across months, each against its own KC. Prices
each shipment, blends by volume, and reverse-solves a single blended price back to a margin.

**Rates & costs** (admin) — every figure a quote is built from. See below.

Quotes are not stored. This prices and exports; it does not keep a book. The deliverable is the
downloaded quote sheet.

## Who sees what

Anyone can build and save quotes. Signing in unlocks the cost tables, the premium, multi-shipment,
and the numbers that would give away cost:

| Hidden from traders | Why |
| --- | --- |
| Cost breakdown | the composition of your cost |
| Break-even | a cost figure |
| Quality premium | a cost figure |
| Margin per pound | a cost figure |
| Cost-table warnings | an admin problem a trader cannot act on |
| Waive fixed cost | a pricing decision, not a quoting one |

Traders keep the full ladder, all three solvers, the schedule, and the differential over KC —
which is what you actually quote, not a cost.

One honest limitation: a trader who sees both a margin and a price can work back to the cost.
Hiding the breakdown hides its *composition*, not the total. If cost has to be genuinely invisible,
the ladder needs unlabelled tiers instead of percentages.

## Editing costs

The admin tables are built for the job rather than for filling in once:

- **Amounts stay as invoiced** — per bag, per container, per truck — with **what that works out to
  per pound** in the next column. No mental arithmetic to see what a change does.
- **A reference quote at the top of the cost table** re-prices live against your unsaved edits, so
  you see `+5.00¢/lb vs saved` before you commit anything.
- **Changed fields highlight**, the bar counts unsaved changes, each row has an **Undo**, and the
  whole table saves in one go.
- Every save is written to the audit log with who and when.

## Rules that differ from the original sheet

1. **Fixed cost is 30¢/lb**, not 25¢. The extra 5¢ covers up to two months of carry on every quote.
2. **Storage and finance are DDP only.** On FOB and CIF the buyer owns the coffee from the port and
   carries it themselves.
3. **The carry has a two-month grace, applied as a deduction.** A five-month hold bills three
   months, not five — otherwise month 2 costs nothing and month 3 costs triple.
4. **The hold can never exceed the shipment window.** Set a two-month window and the selector caps
   at two.
5. **Finance is charged on the full cargo value**, not just the logistics differential. The sheet
   ignored the coffee, which is roughly 75% of what is actually financed.
6. **Margin is explicit** — a share of the selling price, on full landed cost. Both are settings.
7. **Grain Pro and bag marks are permanent lines**, no longer optional.
8. **Traders quote 70 kg jute only.** Admin can use any packaging.
9. **Missing rates warn** rather than silently pricing at zero.

All of it is covered by the engine tests (`npm test`), which reconcile line by line against the
original sheet before applying the changes above.

## Data sources

| Input | Source |
| --- | --- |
| KC forward curve | Entered by hand in Admin — the full curve needs a licensed feed |
| KC spot | *Latest* button: Yahoo Finance, falling back to Stooq |
| Quality premium | Entered by hand in Admin |
| TRM (USD/COP) | Banco de la República via `datos.gov.co` |
| EUR, GBP, AUD, CAD | ECB via `api.frankfurter.app` |

**The KC spot feed is delayed by roughly 10–30 minutes and is not licensed for redistribution.** It
is a convenience for the desk — a starting number a trader confirms against their own feed before
quoting. The field says where the figure came from and how old it is. A failed fetch reports the
error and offers the last stored price rather than blanking the field mid-quote.

Any FX rate can be **pinned** to a manual value, which a fetch will never overwrite — use it to
quote against a booked forward rather than spot. TRM is entered the way a trader says it, pesos per
dollar.

## Running it

```bash
npm install
cp .env.example .env.local     # set ADMIN_PASSWORD and SESSION_SECRET
npm run dev
```

`SESSION_SECRET` has no default on purpose — without it, admin sign-in is disabled rather than
falling back to something guessable:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Engine tests, including reconciliation against the source sheet |
| `npm run seed` | Re-seed reference data (never touches KC prices, premiums or pinned FX) |

The app seeds itself on first boot, so a fresh checkout comes up with the sheet already loaded.

## Open items

- **Unloading (DDP)** is zero for every destination — the sheet never filled it in.
- **Dubai storage** has no rate.
- **35 kg packaging at 24,843 COP** is 2.7x a 70 kg bag for half the volume. Plausible for a vacuum
  pack, worth checking against an invoice.
- **GMF** is a flat 3.19 COP/lb, as in the sheet, not 0.4% of peso flows.
- **Partial containers** warn rather than reprice — freight, port and inland transport assume full
  loads.
- **Multi-shipment shares one hold period.** Per-shipment holds would need a column per row.
- **Quality tiers.** Premiums carry a `quality_key` column but only a `standard` tier is exposed.
- **No quote history.** Removed by request — the calculator prices and exports rather than keeping a
  book. The admin audit log still records every change to the rate and cost tables.

## Layout

```
src/lib/pricing/   engine.ts (pure, tested), schedule.ts, units.ts, types.ts, reference.ts
src/lib/db/        schema.sql, accessors, seed
src/lib/           kcFeed.ts, fx.ts, auth.ts, quoteSheet.ts, format.ts
src/app/           quote, /multi, /admin, /api/kc/latest, server actions
src/components/    QuoteBuilder, MultiShipmentBuilder, shell, admin editors
```

The pricing engine is pure TypeScript with no I/O, so the browser recalculates on every keystroke
while the server recomputes the same numbers when a quote is saved — posted figures are never
trusted.

## Deployment

The rate and cost tables live in SQLite at `data/calculator.db` (override with `DATABASE_PATH`).
That needs a persistent disk, so a long-running Node host or container suits it; a serverless
platform with an ephemeral filesystem would lose every rate edit between invocations.

`fonts.googleapis.com`, `datos.gov.co`, `api.frankfurter.app` and the KC feed hosts must be
reachable from wherever it runs.
