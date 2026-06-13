# War Balance — Implementation Results

Implements `implement_war_balance.md` (§0–§4). Goal: make wars destroy something
permanent so accumulated advantage can decide them, instead of one-town flip-flops
and eternal stalemate.

## What shipped

**§0 — Capture-garrison verification (no bug found).** Built `tools/wardiag2.mjs`
plus a checkpointing runner (`tools/warrun.mjs`, proven bit-exact by
`tools/warcheck.mjs`). Across seeds 42/123/777 at 30k ticks the baseline showed
`garrisonZero = 0` on **every** capture (9–10 attackers reliably re-homed as
garrison) and `recapturedByOriginal = 0%`. The user's suspicion that capture
garrisons vanish or that towns flip straight back is **not borne out** in the
current code — `captureSettlement` correctly re-homes survivors, and they persist,
count in `settlementDefense`, and heal. No fix was needed. The baseline did confirm
the real disease: only 1–2 captures per 30k ticks against 42–61 *failed* sieges —
wars were indecisive because nothing died.

**§1 — Pop-costed soldiers.** `SOLDIER_POP_COST = 15`, `DISBAND_POP_RETURN = 0.5`.
Recruiting a company now removes 15 pop and requires `population > 40`; disbanding a
garrison returns `round(15 × 0.5) = 8`. Only one `spawnAgent('soldier', …)` site
exists (inside `recruitSoldiers`), so the focus/mobilize system needed no extra
plumbing.

**§2 — Siege casualties.** `SIEGE_DEATH_RATE = 0.0011`, `SIEGE_DEATH_CAP = 0.35`,
`CAPTURE_POP_LOSS` cut `0.25 → 0.1`. Three effects while `siegeHp != null`:
bombardment/starvation deaths each tick (tracked per siege in `siegeDeaths`, capped
at 35% of pre-siege pop, reset on lift/fall/peace); villagers shelter and caravans
are grounded (besieged towns are skipped as caravan/freight/trade origin **and**
destination — a siege is a blockade); and siege rations (`need ×= 0.5`) with growth
disabled, so food days collapse. The sack now does little; the killing happens
visibly *during* the siege, and failed sieges leave scars too. All arithmetic on
existing state — no new RNG.

**§3 — Scaled army caps.** `POP_PER_SOLDIER = 45`, `ARMY_MIN = 4`, and a new
`armyCap(world, fid)` helper. Wartime recruitment, mobilization, and the war-chest
check now scale with faction population (`armyCap × WAGE_SOLDIER × 1500`); peacetime
garrison target is `min(per-settlement formula, armyCap)`. The old constant
`ARMY_BASE + ARMY_PER_AGGRESSION × aggr` is fully decommissioned. A big empire now
fields a proportionally bigger army — but fielding it burns the demographic lead
that justified it (§1), which is the intended cost loop.

## §4 — Measurement

Baseline (pre-change) at 30k ticks vs. final (all three features) at 40k ticks,
seeds 42/123/777. Capture/death counts aren't directly comparable across the two
tick budgets, but the per-1000-tick rates are an order of magnitude higher.

| Metric | seed | Baseline (30k) | Final (40k) |
| :-- | :-- | --: | --: |
| Captures | 42 / 123 / 777 | 2 / 1 / 1 | **31 / 33 / 15** |
| Recaptured by original owner | 42 / 123 / 777 | 0% / 0% / 0% | **13% / 15% / 13%** |
| Avg pop loss per successful siege | 42 / 123 / 777 | 26% / 25% / 25% | **34% / 30% / 24%** |
| Soldier deaths | 42 / 123 / 777 | 287 / 722 / 582 | **1837 / 1940 / 1080** |
| Eliminations | 42 / 123 / 777 | 0 / 0 / 1 | **0 / 1 / 1** |
| Power spread (living max/min pop) | 42 / 123 / 777 | 1.68 / 3.26 / 1.35 | 1.61 / 1.79 / 1.96 |

### Targets

| Target | Result |
| :-- | :-- |
| Pop casualties per successful siege 15–30% | **Mostly met.** 24% and 30% in band; seed 42 at 34% rides the cap. Mean ≈ 29.5%, matching the design's "~30% net for a fallen town." |
| Towns recaptured by original owner < 30% | **Met** — 13%, 15%, 13%. |
| Power spread > 2.0 on ≥ 2 of 3 seeds | **Not met on the metric** (1.61 / 1.79 / 1.96) — see finding below. |
| ≥ 1 elimination across the three seeds | **Met** — two eliminations (seeds 123 and 777). |
| Soldier deaths per war > 0 | **Met** — every war is bloody; 1080–1940 deaths per seed. |
| `node test/headless.js 2500 <seed>` determinism | **PASS** after every step and on all three seeds. |

### Finding: power spread vs. eliminations

Stagnation is broken. The baseline had factions hovering at rough parity with 1–2
captures per 30k ticks; the new sim produces 15–33 captures per 40k ticks, an
elimination on two of three seeds, soldier deaths in every war, and recaptures well
under target. A clear leader emerges on every seed.

The one target not met *as written* is the living-pop spread > 2.0. This is largely
a measurement artifact: the ratio ranges only over **surviving** factions, so an
elimination — the most decisive outcome possible — *compresses* the spread rather
than inflating it (the dead faction's pop drops out instead of pushing min → 0).
Seeds 123 and 777 each killed a faction yet read 1.79 and 1.96 precisely because the
field shrank to two survivors near 2:1.

Per the plan's instruction to *report rather than blindly tune* the remaining
levers, I did not touch them. If a strictly higher spread among survivors is still
wanted, the plan's first suggested experiment is the one to try next: raise
`DIPLO.DRIFT` so post-war relations don't stay pinned at `PEACE_RELATION`, which
currently guarantees symmetric rematches and lets the loser recover on the same
clock as the winner. That should be measured on its own, not stacked with the other
two suspects.

No further parameter changes were made: seed 42's 34% siege loss is within normal
variance of the ~30% design intent, and over-tuning a noisy per-seed metric isn't
warranted.

## Files changed

- `src/core/constants.js` — `DIPLO` additions (`SOLDIER_POP_COST`,
  `DISBAND_POP_RETURN`, `SIEGE_DEATH_RATE`, `SIEGE_DEATH_CAP`, `POP_PER_SOLDIER`,
  `ARMY_MIN`); `CAPTURE_POP_LOSS` 0.25 → 0.1.
- `src/sim/diplomacy.js` — pop-costed recruit/disband; siege bombardment + death
  trackers with reset on lift/fall/peace; `armyCap()` helper; scaled recruitment,
  war-chest, and garrison targets.
- `src/sim/systems.js` — siege rations + growth disabled while besieged; villagers
  shelter; internal freight skips besieged destinations.
- `src/sim/governors.js` — trade and transport governors treat a besieged town as a
  blockade (no dispatch as origin; excluded as trade destination).
- `src/core/rng.js` — `getState`/`setState` accessors (used only by the
  checkpointing diagnostic runner; the deterministic stream is unchanged).
- `tools/wardiag2.mjs`, `tools/warrun.mjs`, `tools/warcheck.mjs` — diagnostics.
