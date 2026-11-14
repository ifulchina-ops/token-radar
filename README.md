# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ifulchina-ops/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ifulchina-ops/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of every protocol
it tracks, finds the ones that record no token yet, and ranks them by what
their launch would be worth — then hands in a web dashboard with the board, a
detail view for each protocol, and the steps to farm it.

## How the value is worked out

Each category's multiple is the market's own: the median market-cap-to-TVL
ratio of the protocols in the same snapshot whose token already trades (three
or more of them, else the snapshot-wide median), clamped to 0.05–2.50. Then:

```
implied = TVL × category multiple
        × (1 + clamp(7d %, −60, 120) / 100 × 0.6)
        × (0.7 + min(age, 1095) / 1095 × 0.3)
        × (0.95 + 0.02 × min(chains, 5))
```

No protocol name is ever special-cased — the same formula scores every row.
The dashboard prints the multiple each category actually got, and the detail
view shows the arithmetic row by row. A protocol "records no token" when
DefiLlama's record carries no market cap, no CoinGecko id and no symbol;
that is not proof it has none. Implied values are this radar's own claim,
never a prediction that a token will be issued, or when, or at what price.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory.
Open `out/dashboard/index.html` in a browser: the board is sortable and
filterable, every row opens a detail view with its farm plan, and the live
reference tab shows the protocols that already trade at the market's own
value.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) for the token-radar-01 bounty.</sub>
