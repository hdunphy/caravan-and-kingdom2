# Fix Plan: WP5 Player Faction — Review Follow-ups

Context: WP5 (player-controlled faction / King mode) was implemented as commits on top of WP2–WP4 (branch `add-player`, milestone commit `1d8a738`). A review found the plumbing solid (typecheck clean; headless determinism + save/load PASS) but two must-fix correctness bugs and several gaps versus the WP5 spec in `implement_player_faction_roadmap.md`.

This document is the fix list, ordered by severity. Each item has the exact site, the change, and an acceptance test. **Line numbers drift — re-grep the named symbol before editing.** Standing rules from the roadmap still apply: typecheck with `npm run typecheck`, run the sim with `npm run test:headless -- 2500 42` (or `npx tsx test/headless.ts 2500 42`), sim never imports from `src/ui/`, edicts enter the sim only via the `policy` object.

> **Environment note for the fixing agent:** the reviewer's sandbox had a truncated working-tree mirror and a corrupt git index (`bad index file sha1`). If you see truncated files or `git status` errors, that is a local sync issue — the committed objects are intact. Recover the working tree with `git read-tree HEAD && git checkout-index -a -f` (or re-clone) before trusting on-disk reads, and review against `git show 1d8a738:<path>` if in doubt. No commits were lost.

---

## Repro for the headline bug (run this first, keep it as a regression check)

```js
// cmp.mjs — proves the hardcoded player changes AI-only behavior
import { generateWorld } from './src/sim/worldgen.js';
import { run, summarize } from './src/sim/gameLoop.js';
const wPlayer = run(generateWorld(42, 24, 4), 2500);          // current default (player hardcoded to 0)
const wObs = generateWorld(42, 24, 4); wObs.playerFactionId = null; run(wObs, 2500);
console.log(JSON.stringify(summarize(wPlayer)) === JSON.stringify(summarize(wObs))
  ? 'IDENTICAL' : 'DIVERGES');
```
Today this prints `DIVERGES` (with player=0, Aurelia runs on default policy instead of its traits; e.g. Vesper survives in one case and is eliminated in the other). **After Fix 1 + the headless default, the normal `generateWorld(...)` path must produce a null player, and an observer run must match the pre-WP5 baseline.**

---

## Fix 1 — CRITICAL: `playerFactionId` defaults to a real faction

**Problem:** `src/sim/worldgen.ts` hardcodes `playerFactionId: 0`. The roadmap requires `null` = observer (current/headless behavior). As-is, every headless/observer world silently makes faction 0 the "player," which is then skipped in the Court's trait→policy loop, so its behavior diverges from a true AI faction. This violates the WP5 acceptance criterion *"AI-only worlds (playerFactionId null) remain byte-identical to pre-WP5 headless runs."*

**Changes:**
1. `src/sim/worldgen.ts`: change `playerFactionId: 0` → `playerFactionId: null`.
2. `src/types.ts`: add a typed field to the `World` interface — `playerFactionId: number | null;`. (It currently compiles only via the `[key: string]: any` index signature, so it is typed `any` with no null-safety. Consider also removing or narrowing that index signature later, but that is out of scope here.)
3. Standardize the sentinel on `null`, not `undefined`. Audit every `playerFactionId !== undefined` check (notably in `src/main.ts` and `src/ui/hud/updateHud.ts`) and change to `!= null` / `world.playerFactionId !== null`.
4. The player is chosen only via the new-world UI flow (Fix 6). Headless/observer never sets it.

**Accept:**
- `npm run typecheck` clean.
- The repro above prints `IDENTICAL`.
- Observer run (`generateWorld(...)` with player left null) `summarize()` matches the pre-WP5 headless baseline in `planning/headless-baseline.txt` (regenerate the baseline only if it predates the TS refactor; otherwise it must match).
- `npm run test:headless -- 2500 42` still PASS (determinism + save/load + health).

## Fix 2 — HIGH: player faction must skip war declarations and gifts, not just policy

**Problem:** the player-skip guard exists only in the Court's policy-setting loop (`src/sim/diplomacy/court.ts`, the `if (fac.id === world.playerFactionId) continue;` near the top). The war-declaration sites (`declareWar(world, fid, ...)` — re-grep, was ~lines 271, 325, 344, 393) and gift sites (`considerGift(world, fid)` — was ~353, 361) have **no** player guard, so the AI still declares wars and sends gifts on the player's behalf. The roadmap requires the player to skip *policy-setting, gift decisions, AND war declarations* — war/peace become player actions.

**Changes (in `src/sim/diplomacy/court.ts`):**
- Guard each AI-only decision so the player faction is excluded. Cleanest is a single early helper at the top of the per-faction decision loop(s): `if (fid === world.playerFactionId) continue;` before any `declareWar(...)` / `considerGift(...)` for that faction. Make sure you do **not** skip behavior the player should keep — the Court must still enforce legality and upkeep for the player: truce/war-chest checks, garrison maintenance (`manageGarrison`), and the automatic peace at `DIPLO.SUE_THRESHOLD` (so a ruined player kingdom can't fight forever).
- Verify there is no other AI decision site outside `court.ts` that initiates war/gifts for an arbitrary `fid` (check `src/sim/diplomacy/peacetime.ts`); guard those too if present.

**Accept:**
- Scripted test: set `world.playerFactionId = 1`, run 3,000 ticks, assert no `wars` entry was *initiated by* faction 1 and no gift originated from faction 1 (scan `world.log` / `world.diplo.wars`), while wars/gifts among AI factions still occur.
- With player = null, behavior is unchanged from Fix 1's observer baseline (determinism PASS).

## Fix 3 — MEDIUM: expose `declareWar` as a player action in the UI

**Problem:** only "Sue for Peace" is wired. The roadmap's Crown tab wants war/peace buttons **per rival**, with relation + strength comparison shown. `declareWar` already exists in `src/sim/diplomacy/war.ts` with signature `declareWar(world, attackerId, defenderId, goalId, isInitial=false)`.

**Changes:**
- Add a thin player helper (e.g. `playerDeclareWar(world, targetId)` in `war.ts` or `policy.ts`) that picks a goal via the existing `pickWarGoal(world, fid, enemyFid)` and calls `declareWar(world, world.playerFactionId, targetId, goal.id, true)` — but only if legal (not already at war, no active truce, war-chest available; reuse the Court's existing legality checks rather than duplicating them).
- UI (`src/ui/hud/updateHud.ts` + handler in `src/main.ts`): per living rival, render relation and a strength comparison (use `src/sim/diplomacy/strength.ts` / `relations.ts`) plus a "Declare War" button (when at peace) or the existing "Sue for Peace" button (when at war). Follow the existing `sue-peace-btn` delegation pattern in `main.ts`.

**Accept:** in-browser smoke test: declare war on a rival → war appears; sue for peace → war ends. Determinism unaffected (UI-only entry point; edicts/actions enter sim as data).

## Fix 4 — MEDIUM: make Sue-for-Peace's win/lose semantics deliberate

**Problem:** `src/main.ts` calls `makePeace(world, war, world.playerFactionId)` and the new `sueForPeace(world, war, factionId)` in `src/sim/diplomacy/peace.ts` just forwards to `makePeace(world, war, loser)`. The third arg is the **loser**, so the player always eats the loser's peace penalty even when winning. Also `main.ts` bypasses the `sueForPeace` helper.

**Changes:**
- Decide intent. "Sue for peace" conventionally = the suer concedes, so passing the player as loser is defensible — but make it explicit in a comment, OR compute the loser by exhaustion (`war.exh`) so a dominant player isn't penalized. Pick one and document it.
- Route the UI through `sueForPeace(...)` rather than calling `makePeace(...)` directly, so the policy lives in one place.

**Accept:** unit test on `sueForPeace` asserting the resulting relation/penalty matches the documented intent for both "player ahead on exhaustion" and "player behind" cases.

## Fix 5 — MEDIUM: win/loss conditions and map rendering of the player realm

**Problem (missing WP5 deliverables):**
- No win/loss handling: roadmap wants loss = elimination → "dynasty ends" banner + offer observer mode; win = last faction standing or >60% of world population.
- No gold ring on owned settlements **on the map**. Only the sidebar faction row got gold styling; `src/ui/renderer.ts` is untouched.

**Changes:**
- Sim or UI tick check (keep it derived/UI-side to preserve determinism): detect player elimination (no settlements for `playerFactionId`) and victory (player is last alive, or player population / total world population > 0.6). Surface via the WP4 alert/banner layer.
- `src/ui/renderer.ts`: draw a subtle gold ring on settlements owned by `playerFactionId`.
- UI: "dynasty ends" banner with a "continue as observer" action that sets `world.playerFactionId = null`.

**Accept:** scripted scenarios trigger each end-state; banner renders; "continue as observer" flips to null and the sim keeps running. Gold ring visible on player settlements only.

## Fix 6 — MEDIUM: new-world flow ("Observe" vs "Rule a kingdom") + faction picker

**Problem:** there is no way to choose a faction or to start as a pure observer; the player was simply hardcoded. This is the UI counterpart to Fix 1.

**Changes (UI only, `src/main.ts` / `index.html` / `src/ui/hud/`):**
- On new world / reseed, present "Observe" (sets `playerFactionId = null`) or "Rule a kingdom" → faction picker that sets `playerFactionId` to the chosen id.
- Default boot = observer (null), matching headless.
- Persist the choice through save/load (verify `playerFactionId` is included by `saveWorld`/`loadWorld` in `src/sim/serialize.ts`; add it if missing).

**Accept:** choosing Observe → null player, AI-only behavior. Choosing a faction → Crown tab controls that faction. Save → load round-trip preserves `playerFactionId` (extend the existing round-trip test).

## Fix 7 — LOW: confirm WP2 trait→policy mappings are intended

`courtSystem` sets `fac.policy.recruitment = traits.aggression`. That is a reasonable proxy for "recruit appetite" but was a reviewer assumption — confirm it matches design intent, and confirm `militaryStance` threshold (`aggression >= 1.2 ? 'AGGRESSIVE' : 'BALANCED'`) is what you want for AI factions. No code change required if intended; note the decision.

---

## Suggested order & sizing

| Fix | Severity | Size | Notes |
| :-- | :-- | :-- | :-- |
| 1 Default player = null + typed field | Critical | S | unblocks correct baseline |
| 2 Skip war/gifts for player in Court | High | S | restores player control of war |
| 6 New-world picker (+ serialize) | Medium | M | UI counterpart to Fix 1 |
| 3 Declare-war UI action | Medium | M | depends on 2 |
| 5 Win/loss + gold ring | Medium | M | |
| 4 Sue-for-peace semantics | Medium | S | |
| 7 Confirm WP2 mappings | Low | XS | decision, not code |

**Definition of done for WP5:** Fixes 1–6 implemented; `npm run typecheck` clean; `npm run test:headless -- 2500 42` PASS (determinism + save/load + health); the repro script prints `IDENTICAL`; observer run matches the pre-WP5 baseline; full in-browser playthrough (pick faction → set edicts → declare/sue war → win or lose → continue as observer) works.
