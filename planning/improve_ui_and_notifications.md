# Implementation Plan: Player-Control UI Clarity + Notification Tiering

Two related problems with the current King-mode UX:

1. **Policy controls are opaque.** Every slider is a bare `0.1–3.0` multiplier with a vague one-liner. The player has no idea what `Expansion Focus = 1.4` actually *does*. Behind each knob is an exact sim formula — the UI should surface the resulting in-game value (e.g. "found a new settlement when a town reaches **18 pop**"), not the multiplier.
2. **Notifications are noisy and useless.** `pushAlert` fires for **every faction's** settlements (not just the player's), there are only four ad-hoc types, the toasts can't be clicked, can't pause the game, and have no severity. Important and trivial events look identical.

This plan covers both. It is grounded in the current code (branch `add-player`, commit `1d8a738`). **Re-grep symbols before editing — line numbers drift.** Standing rules: `npm run typecheck` + `npm run test:headless -- 2500 42` after changes; sim never imports from `src/ui/`; alerts/UI are derived state and must not affect determinism.

> Environment note: the reviewer's sandbox showed a truncated working tree + corrupt git index. If on-disk files look truncated, recover with `git read-tree HEAD && git checkout-index -a -f` or review via `git show 1d8a738:<path>`. No commits lost.

---

# Part A — UI review (current state)

Files: `index.html` (all markup + inline CSS, ~433 lines), `src/ui/hud/updateHud.ts` (renders factions/inspector/log/alerts), `src/main.ts` (event wiring, game loop), `src/ui/hud/chart.ts` (analytics).

What's clunky today:

- **Sliders show multipliers, not effects.** Six `<input type=range>` in the Policy tab emit `0.1–3.0` with static captions. No live readout of the real consequence; no current-state context (e.g. what your towns are doing *now*).
- **Binary stance hides a third option.** The "Aggressive Military Stance" checkbox only toggles `DEFENSIVE ↔ AGGRESSIVE`. The sim also supports `BALANCED` (the AI default), which the player can never select.
- **Everything mutates instantly and silently.** Slider `input` writes straight to `policy`; fine functionally (the Court skips the player so edits persist), but there's no confirmation, no "what changed", no undo/reset, no presets.
- **Alerts overlay is inert.** `#alerts-panel` is `pointer-events: none` — you can't click an alert to jump to the settlement. It also shows alerts for AI factions, so it's mostly spam.
- **No player-faction framing.** The Policy tab doesn't show *whose* policy you're editing, your treasury/army/food at a glance, or your rivals. (The Kingdoms tab has some of this but it's not connected to the act of ruling.)
- **Ininline styles everywhere.** Markup is built with long inline-style string templates in `updateHud.ts`, which makes consistent restyling painful. Recommend promoting repeated patterns to CSS classes in `index.html` as you touch them.

---

# Part B — Make every policy control show its real effect

**Goal:** each control displays the concrete in-game value it produces, recomputed live from the same constants the sim uses. When a knob drives multiple things, show each. Pull numbers from `src/core/constants/economy.ts` and `diplo.ts` (import them in the UI — UI may import from core/constants, just not from `src/sim/`’s mutators; reading `policyOf`/pure helpers is fine).

Current constant defaults (for reference): `EXPAND_MIN_POP=25`, `SETTLER_SCALING=0.5`, `FOOD_PER_POP=0.05`, `GOLD_INCOME_PER_POP=0.004`, `TRADE_SURPLUS_MIN=200`, `GARRISON_PEACE=1`, jobCap V/T/C = 8/16/28.

Replace each slider's static caption with a **dynamic readout** computed from the live value. Exact mapping (verified against the sim sites):

| Control | Sim site | Show instead of the multiplier |
| :-- | :-- | :-- |
| **Expansion Focus** `expansion` | `governors/index.ts`: `pop >= EXPAND_MIN_POP / expansion`; settler cost `÷ expansion` | "Found a new settlement once a town reaches **{round(25/expansion)} pop**. Settlers cost {…}% {less/more}." e.g. 1.0→25 pop, 2.0→13 pop, 0.5→50 pop |
| **Trade Stance** `tradeStance` | `governors/trade.ts`: buy target `×ts`; export when `stock > TRADE_SURPLUS_MIN / ts`; `0` disables | "Buy imports until stock reaches **{round(max(40,need)×ts)}**; sell anything above **{round(200/ts)}**. **0 = no trade (autarky).**" |
| **Military Recruitment** `recruitment` | `governors/labor.ts`: `maxVillagers = min(jobCap, floor(pop/3)) × rec`; `war.ts`: soldier target `× rec` | "Towns employ up to **{×rec}** workers (capped by jobs: 8/16/28 by tier). In war, recruit **{×rec}** the soldier target." |
| **Garrison Size** `garrison` | `peacetime.ts`: `round(settlements × GARRISON_PEACE × (aggr?2:1) × garrison)` | "Keep **~{round(yourSettlements × 1 × garrison)} standing soldiers** in peacetime (across {n} settlements)." Compute from the player's live settlement count. |
| **Tax Rate** `taxRate` | `metabolism.ts`: income `× taxRate`; if `>1.2` growth `×0.9` | "Tax income **{×taxRate}**. ⚠ Above 1.2× your population growth drops 10%." Turn the caption red past 1.2. |
| **Food Rations** `rations` | `metabolism.ts`: food need `× rations`; if `<0.8` growth `×0.9` | "Each citizen eats **{×rations}** food. ⚠ Below 0.8× growth drops 10%." Turn red below 0.8. |
| **Military Stance** | `war.ts`: AGGRESSIVE → siege ×1.5, raid ×1.5; DEFENSIVE → defend/intercept favored | Replace the checkbox with a **3-way segmented control** Defensive / Balanced / Aggressive, with a one-line description of each (so BALANCED becomes reachable). |

Implementation notes:
- Put the readout math in a small pure helper, e.g. `src/ui/hud/policyLabels.ts`, taking `(policy, world)` and returning the description strings. Keep it pure so it can be unit-tested and reused.
- Recompute readouts in `updateHud` (which already runs on the HUD timer) **and** on slider `input` for instant feedback. The two-way sync block already exists in `updateHud.ts` — extend it.
- For compound knobs that depend on town state (Garrison uses settlement count; Recruitment caps by tier jobCap), show a representative live number using the player's actual settlements where possible, and a formula otherwise.
- Add a **Reset to defaults** button and consider 2–3 **presets** ("Peaceful Growth", "War Economy", "Merchant Republic") that set all knobs at once — far more legible than tuning six sliders blind.

**Accept:** moving any slider updates its readout to the correct computed value live; stance is 3-way and can select Balanced; readouts match a hand-computed check for 2–3 values per knob; no sim/determinism change (`test:headless` PASS).

---

# Part C — Notification tiering: Log / Popup / Pausing Alert

**Goal:** one event stream, three presentation tiers, all scoped to the player.

### C1. Severity + scope on the data model
- Extend the `Alert` interface in `src/types.ts`:
  ```ts
  export type AlertSeverity = 'INFO' | 'IMPORTANT' | 'CRITICAL';
  export interface Alert {
    type: 'STARVATION' | 'BANKRUPT' | 'SIEGE' | 'STAGNANT'
        | 'WAR_DECLARED' | 'SETTLEMENT_LOST' | 'SETTLEMENT_CAPTURED'
        | 'PEACE_SIGNED' | 'EXHAUSTION_HIGH';
    severity: AlertSeverity;
    factionId: number | null;   // who it concerns; null = world event
    tick: number;
    targetId?: number;
    q?: number; r?: number;     // for click-to-pan
    msg: string;
    acknowledged?: boolean;     // CRITICAL only
  }
  ```
- Update every `pushAlert(...)` call site to pass `severity`, `factionId`, and `{q,r}` where known:
  - `systems/metabolism.ts` — SIEGE (IMPORTANT), STARVATION (IMPORTANT, escalate to CRITICAL if foodDays < 3).
  - `systems/maintenance.ts` — BANKRUPT (IMPORTANT).
  - `governors/index.ts` — STAGNANT → **demote to INFO (log only)**; this is the main spam source.
  - Add new emissions (roadmap WP4 list): WAR_DECLARED (CRITICAL) in `diplomacy/war.ts` `declareWar`; SETTLEMENT_LOST/CAPTURED (CRITICAL/IMPORTANT) where settlements change owner (`diplomacy/combat.ts` / `settlement.ts`); PEACE_SIGNED (IMPORTANT) in `diplomacy/peace.ts` `makePeace`; EXHAUSTION_HIGH (INFO/IMPORTANT) when `war.exh` crosses 50.

### C2. Player scoping (kills the noise)
- In `pushAlert` (`src/sim/settlement.ts`), keep storing **all** alerts (deterministic, fine), but rendering filters by the player.
- In the UI, only **popup/pausing** tiers are shown for `alert.factionId === world.playerFactionId` (or `factionId === null` world events). Everything else stays in the log only. When `playerFactionId === null` (observer), suppress popups/pausing entirely — observers just watch the log.

### C3. The three tiers in the UI
1. **Log (all events).** Already exists: the Chronicle tab renders `world.log`. Keep it as the complete history. Optionally merge INFO alerts into it, and add a severity filter alongside the existing all/war/trade/build filters. This is the catch-all — nothing interrupts the player here.
2. **Popup (IMPORTANT).** Reuse `#alerts-panel` but make it useful: transient toasts that **auto-dismiss after ~6s**, **stack max 3**, are **clickable** (remove `pointer-events: none`) → clicking pans the camera to `{q,r}` (use `src/ui/camera.ts`) and/or opens the Inspector. Player-scoped per C2.
3. **Pausing alert (CRITICAL).** A modal/banner that **sets `speed = 0`** (the `speed` variable lives in `src/main.ts`) and requires the player to acknowledge ("Continue" / "Go to settlement"). Used for WAR_DECLARED and SETTLEMENT_LOST. Set `alert.acknowledged` so it doesn't re-fire. Respect a user toggle "Pause on critical events" (default on).

### C4. Determinism guard
Alerts are derived state. Pausing/popups are pure UI reactions to `world.alerts`; they must not write back into the sim. Keep the existing age-out (`gameLoop.ts`: alerts older than 15 ticks are dropped) — but CRITICAL alerts should persist until acknowledged, so exclude `severity==='CRITICAL' && !acknowledged` from the age-out filter. Verify `test:headless` determinism unchanged.

**Accept:** scripted scenario emits one of each tier — INFO appears only in the log; IMPORTANT pops a clickable toast that pans on click and auto-dismisses; CRITICAL pauses the game and waits for acknowledgement; an AI-only (non-player) starvation/siege never pops a toast; observer mode shows no popups; `test:headless` determinism + health PASS.

---

# Part D — Broader UI polish (optional, do after B & C)

- **Crown/Policy header:** show the player faction name + a compact treasury / army / food / settlement-count strip at the top of the Policy tab, so edicts have visible context.
- **Rivals row:** per living rival show relation + a strength bar + a Declare War / Sue for Peace button (ties into `fix_player_faction_wp5.md` Fix 3).
- **Extract inline styles** to CSS classes as you touch templates in `updateHud.ts`.
- **Empty/observer states:** when `playerFactionId === null`, the Policy tab should say "Observing — no kingdom to rule" rather than showing live sliders that edit nothing.

---

## Suggested order & sizing

| Part | What | Size | Notes |
| :-- | :-- | :-- | :-- |
| B | Slider real-value readouts + 3-way stance + reset/presets | M | biggest clarity win; UI + a pure label helper |
| C1–C2 | Alert severity/scope data model + player filtering | M | kills the noise; touches sim emission sites |
| C3 | Three-tier rendering (log / popup / pausing) | M | UI + main.ts speed control |
| C4 | Determinism guard + tests | S | |
| D | Header/rivals/CSS polish | M | optional, after the above |

**Definition of done:** policy controls read in concrete game terms and update live; military stance is 3-way; notifications are player-scoped with log / auto-dismiss popup / pausing-critical tiers and click-to-pan; `npm run typecheck` clean; `npm run test:headless -- 2500 42` PASS (determinism + save/load + health); manual playthrough confirms no AI-faction spam and that war/loss pauses the game.
