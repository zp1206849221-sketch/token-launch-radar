# Token Launch Radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)
[![rank](https://make.fun/badge/token-radar-01/zp1206849221-sketch/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)
[![reward](https://make.fun/badge/token-radar-01/zp1206849221-sketch/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)

This entry ranks 193 pre-token protocols from the sealed DefiLlama snapshot by their implied launch value, estimated with a fitted peer-multiple valuation model: a global log-log size curve blended with shrunk category multiples and — for categories with at least 8 tokenised peers — the category's own shrunk log-log regression, adjusted by momentum and track-record factors. The candidate set covers the snapshot's full 40-protocol watchlist; above the $50M floor it also admits, one by one, the pre-token protocols the watchlist left out that a documented blind-spot review in the model finds are not products of a token that already trades; below the floor it fills up to 200 rows with the largest pre-token protocols that pass the watchlist's own hygiene. Every row carries a confidence score (peer support, fit quality, and whether the protocol's size sits inside the range its pricing curve was fitted on) and the full model breakdown, plus a protocol-specific farm plan with an itemised cost table, a weekly upkeep load and risk notes, for positioning ahead of a potential token launch. The results are presented in a hand-written static dashboard with a sortable board (including sort by confidence), per-protocol detail views with an itemised value breakdown and plan timeline, and filters.

## How it works

- The valuation model lives in `lib/model.ts` — it fits the peer multiples on the snapshot's tokenized protocols and applies them to the pre-token set.
- The same file holds the blind-spot review table: every above-floor pre-token protocol the watchlist omitted, with an include/exclude verdict and the snapshot evidence for it, so the coverage decision for each one can be audited. Its confidence score is calibrated so the board's top ranks are not systematically its least-supported rows: peer support is counted on a log scale, and the size term measures distance from the range the pricing model was actually fitted on (the category median for well-populated categories, the global peers' 5th–95th percentile range otherwise).
- `main.ts` reads the snapshot and writes `board.json`, the dashboard's `data.js`, and `dossier.json` to the output directory.
- `dashboard/` is a self-contained static page (no build step, no network calls) that renders the board from `data.js`.
- `screenshots/` holds the three views: the board, a protocol detail, and a filtered board.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```
