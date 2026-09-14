import assert from "node:assert/strict";
import { accumulateOverall, emptyTimesCopyAllowed } from "../lib/overall-math.ts";

// Cancelled stages still occupy itinerary slots; they add no time.
{
  const statuses = ["Completed", "Completed", "Cancelled", "Completed", "Waiting"];
  const times = [10000, 20000, null, 30000, null];
  const r = accumulateOverall(statuses, times);
  assert.ok(r);
  assert.equal(r.lastStage, 4);
  assert.equal(r.totalMs, 60000);
}

// Hot stage time is included when present.
{
  const statuses = ["Completed", "Hot"];
  const times = [5000, 1500];
  const r = accumulateOverall(statuses, times);
  assert.ok(r);
  assert.equal(r.lastStage, 2);
  assert.equal(r.totalMs, 6500);
}

// Hole on a completed stage stops later times.
{
  const statuses = ["Completed", "Completed", "Completed"];
  const times = [1000, null, 9000];
  const r = accumulateOverall(statuses, times);
  assert.ok(r);
  assert.equal(r.lastStage, 1);
  assert.equal(r.totalMs, 1000);
}

// Empty copy only if both sources are empty.
assert.equal(emptyTimesCopyAllowed(false, false), true);
assert.equal(emptyTimesCopyAllowed(true, false), false);
assert.equal(emptyTimesCopyAllowed(false, true), false);
assert.equal(emptyTimesCopyAllowed(true, true), false);

console.log("phase1-e fixtures ok");
