# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ifulchina-ops/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ifulchina-ops/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Comps-fitted token launch radar (model radar-3): every rankable pre-token protocol in the sealed DefiLlama snapshot, ranked by an implied value fitted from the protocols whose tokens already trade — log market cap on log TVL, growth, age and chains, plus shrunk category effects, Huber-reweighted, tested out of sample (leave-one-out + time split) with a 200-resample bootstrap band per row. Every row carries an 8-step farm plan netted to the dollar and a farm / watch / skip verdict. Static dashboard, no network.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (or newer), standard library only. Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Deterministic: two runs write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
