# Token Launch Radar

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)
[![rank](https://make.fun/badge/token-radar-01/zp1206849221-sketch/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)
[![reward](https://make.fun/badge/token-radar-01/zp1206849221-sketch/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-launch-radar)

This entry ranks 178 pre-token protocols from the sealed DefiLlama snapshot by their implied launch value, estimated with a fitted peer-multiple valuation model: a log-log size curve blended with shrunk category multiples, adjusted by momentum and track-record factors. Every ranked protocol comes with a concrete farm plan for positioning ahead of a potential token launch. The results are presented in a hand-written static dashboard with a sortable board, per-protocol detail views, and filters.

## How it works

- The valuation model lives in `lib/model.ts` — it fits the peer multiples on the snapshot's tokenized protocols and applies them to the pre-token set.
- `main.ts` reads the snapshot and writes `board.json`, the dashboard's `data.js`, and `dossier.json` to the output directory.
- `dashboard/` is a self-contained static page (no build step, no network calls) that renders the board from `data.js`.
- `screenshots/` holds the three views: the board, a protocol detail, and a filtered board.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```
