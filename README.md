# token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tenamusic/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tenamusic/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for make.fun's [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) — "Build the best token launch radar".

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot and ranks 178
protocols whose token does not exist yet: the snapshot's full 40-protocol watchlist plus 138
further pre-token protocols that pass the watchlist's own independence tests below the $50M
floor (no exchanges, no wrapped/staked/bridged products of already-tokened protocols, no
versioned pools). Protocols that already trade are never ranked; the largest are shown
separately at the market's own values.

The model (version `radar-2`, in `lib/model.ts`) prices a launch from the snapshot's own
figures only:

```
implied value = TVL x category multiple x growth factor x vintage factor x reach factor
```

- **Category multiple** — the median market-cap / TVL of the snapshot's own tokenised
  protocols in the same category (≥2 peers, else the all-category median), clamped to
  0.20–2.50. Derived from the data at run time, never typed in.
- **Growth factor** — 1 + clamp(7-day TVL change, −50%, +100%) × 0.60.
- **Vintage factor** — 0.80 + 0.45 × min(days live without a token, 1460) / 1460; an unknown
  listing date counts as one year.
- **Reach factor** — 1 + 0.03 × extra chains, up to +30%.

Every board row carries its four factors, so any reader can recompute its implied value.
Each row also carries a six-step farm plan generated from the protocol's category, main
chain, TVL and age — the core action, a second interaction, a weekly cadence with a momentum
note from its own 7-day change, a holding window, and exit discipline — every step with its
cost and its time.

The dashboard (`dashboard/`, static, no network) is a dark scope-themed page: the ranked
board with search, category / chain / minimum-TVL filters, a watchlist-only toggle and five
sort orders; a detail view per protocol with the factor breakdown and the farm plan; the
live-token set kept apart; and the model stated in full, including the category-multiple
table derived from tokenised peers. `main.ts` writes `board.json` and `data.js`, copies
`dashboard/` and `screenshots/`, and writes `dossier.json` last with the vendored
`buildDossier`.

Run it the way the grader does:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```
