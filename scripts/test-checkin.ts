/**
 * Stage 1 terminal test script.
 *
 * Usage:
 *   npm run test:clean        # single clean check-in (LOAD-001)
 *   npm run test:escalation   # breakdown scenario (LOAD-005)
 *   npm run test:all          # run both back-to-back
 */

import { runCheckIn } from "../src/agent.js";
import { getAllStatuses } from "../src/store.js";
import { MOCK_LOADS } from "../src/mockData.js";
import { GetCarrierReply } from "../src/types.js";

// ---------------------------------------------------------------------------
// Stub: clean check-in (LOAD-001, Swift Transport, Chicago → Nashville)
// Turn counter drives responses — agent always asks location first, then ETA.
// ---------------------------------------------------------------------------
function makeCleanStub(): GetCarrierReply {
  let turn = 0;
  return async (_agentMessage: string): Promise<string> => {
    turn++;
    if (turn === 1) return "I'm on I-65 South, just passed Bowling Green, Kentucky.";
    if (turn === 2) return "Should be in Nashville around 3:30 PM today, no issues.";
    return "Yes, that sounds right.";
  };
}

// ---------------------------------------------------------------------------
// Stub: escalation path (LOAD-005, Southeastern Trucking, Atlanta → Charlotte)
// Carrier reports a blown tire on turn 1 — escalation check should fire.
// ---------------------------------------------------------------------------
function makeEscalationStub(): GetCarrierReply {
  let turn = 0;
  return async (_agentMessage: string): Promise<string> => {
    turn++;
    if (turn === 1)
      return (
        "I'm on I-85 North near Spartanburg, South Carolina — " +
        "but I need to tell you, my truck broke down. Blown tire. " +
        "I'm on the shoulder waiting for roadside assistance."
      );
    if (turn === 2)
      return "I'm at mile marker 85 on I-85 North, near Spartanburg, SC.";
    if (turn === 3)
      return "Probably 4 to 5 hours from now, depending on when roadside gets here.";
    return "Yes, understood.";
  };
}

// ---------------------------------------------------------------------------
// Print a summary of all logged statuses at the end
// ---------------------------------------------------------------------------
function printSummary(): void {
  const statuses = getAllStatuses();
  if (!statuses.length) return;

  console.log(`\n${"=".repeat(60)}`);
  console.log("FINAL STORE STATE");
  console.log("=".repeat(60));
  for (const s of statuses) {
    console.log(`\nLoad: ${s.load_id}`);
    console.log(`  status           : ${s.status}`);
    console.log(`  current_location : ${s.current_location ?? "(none)"}`);
    console.log(`  eta              : ${s.eta ?? "(none)"}`);
    console.log(`  notes            : ${s.notes || "(none)"}`);
    console.log(`  flagged          : ${s.flagged}`);
    if (s.flagged) console.log(`  flag_reason      : ${s.flag_reason}`);
    console.log(`  updated_at       : ${s.updated_at}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const mode = process.argv[2] ?? "clean";

  if (mode === "clean" || mode === "all") {
    const load = MOCK_LOADS.find((l) => l.id === "LOAD-001")!;
    const result = await runCheckIn(load, makeCleanStub());
    console.log(`\nResult: status_logged=${result.status_logged}, final_status=${result.final_status.status}`);
  }

  if (mode === "escalation" || mode === "all") {
    const load = MOCK_LOADS.find((l) => l.id === "LOAD-005")!;
    const result = await runCheckIn(load, makeEscalationStub());
    console.log(`\nResult: status_logged=${result.status_logged}, final_status=${result.final_status.status}`);
  }

  if (mode !== "clean" && mode !== "escalation" && mode !== "all") {
    console.error(`Unknown mode "${mode}". Use: clean | escalation | all`);
    process.exit(1);
  }

  printSummary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
