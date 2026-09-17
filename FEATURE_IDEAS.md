# RallySafe Paranoia — Feature Ideas / Backlog

## Predictions Feature (proposed)

**Phase A — Predictive/Historical Results**
- Show predictive results for drivers based on historical performance (past events, stage times, finishing positions, retirements, etc.)
- Historical stats view per driver: past finishes, DNFs, average stage pace, event history

**Phase B — Community Prediction Game ("predict the rally")**
- Build out from Phase A into a free, for-fun prediction market for rallying — like a fantasy/predictions market but with **zero money changing hands**, just for fun/bragging rights
- Users predict things like:
  - A driver's finishing position for an event
  - Whether specific events will occur (e.g. a retirement, a stage win, a particular driver DNF, etc.)
- No real-money betting/stakes — purely a for-fun predictive game layered on top of the historical/predictive data from Phase A

## Reliable incident / resume / "car out" lifecycle (proposed)

**Goal:** know when a car genuinely crashes/stops, when it's genuinely running again, and when it's been swept/towed out — without false positives or a car on a tow truck "coming back to life" and spamming alerts.

### Layered detection (redundant on purpose)

**Layer 1 — the RallySafe unit's own flags (primary)**
- Incident: `safetyStatus >= 2` (hazard / SOS — auto-set on stop and on high-G impact).
- Resumed: `racingStatus` flips 0→1 (back on stage and racing).
- Out: `competitionStatus` (likely encodes running/retired/excluded — enum UNCONFIRMED, only seen `0` so far).

**Layer 2 — cross-check from the same live packet (backup if flags glitch)**
- Resumed: `stageNumber` advances to the next stage — a towed car's stage number doesn't move on; a running car's does.
- Out: `safetyStatus` clears to 0 AND `racingStatus` stays 0 for a sustained window while the car keeps moving away (the swept/towed signature).

**Layer 3 — a separate data source (independent of the unit's live flags)**
- The combiner's `retirements` array, and the results API "hole" rule (no time on a stage everyone else completed) — the same signals the standings already use to mark DNFs.

### Voting rules
- **"Back running" alert** fires only when: `racingStatus` 0→1 AND (stage number advanced OR real speed/position progress). Tow trucks fail the second check.
- **"Car is out — stop watching"** when: `competitionStatus` = retired/excluded OR combiner says retired OR results show the stage-hole. Any one is enough.
- **On disagreement, default to "out"** — a false "they're running" is worse than a false "they're out."

### Open items to confirm on live data
- `competitionStatus` enum — what value means retired/excluded (only `0` observed so far).
- `safetyStatus` enum under real hazard/SOS/OK conditions (server already logs non-zero values).
- Consider adding the same non-zero logging for `competitionStatus`.

### Current state
- Not implemented. Incident alerts already use `safetyStatus` + a "stopped on stage" fallback; re-arm is currently movement+speed based and has NO "resumed" notification and NO explicit "car out" state.

## Notes
- No implementation started yet — just captured as a future idea to build out from the historical data work.
