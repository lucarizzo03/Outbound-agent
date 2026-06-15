/**
 * Stage 1 terminal test script.
 *
 * Usage:
 *   npm run test:clean        # single clean check-in (LOAD-001)
 *   npm run test:escalation   # breakdown scenario (LOAD-005)
 *   npm run test:all          # run both back-to-back
 */

import "dotenv/config";
import { runCheckIn } from "../src/agent.js";
import { getAllStatuses } from "../src/store.js";
import { MOCK_LOADS } from "../src/mockData.js";
import { makeCleanStub, makeEscalationStub } from "../src/stubs.js";

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
    const result = await runCheckIn(load, makeCleanStub(load));
    console.log(`\nResult: status_logged=${result.status_logged}, final_status=${result.final_status.status}`);
  }

  if (mode === "escalation" || mode === "all") {
    const load = MOCK_LOADS.find((l) => l.id === "LOAD-005")!;
    const result = await runCheckIn(load, makeEscalationStub(load));
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
