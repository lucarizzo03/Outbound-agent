import { MOCK_LOADS } from "./mockData.js";
import { runCheckIn } from "./agent.js";
import { stubForLoad } from "./stubs.js";
import { startActiveObservation } from "@langfuse/tracing";

export type LoadProgressStatus = "pending" | "in_progress" | "completed" | "failed";
export type RunStatus = "in_progress" | "completed" | "failed";

export interface LoadProgress {
  load_id: string;
  status: LoadProgressStatus;
  error?: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  loads: LoadProgress[];
  started_at: string;
  finished_at?: string;
}

const runs = new Map<string, Run>();

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function createRun(): Run {
  const run: Run = {
    id: crypto.randomUUID(),
    status: "in_progress",
    loads: MOCK_LOADS.map((l) => ({ load_id: l.id, status: "pending" })),
    started_at: new Date().toISOString(),
  };
  runs.set(run.id, run);
  return run;
}

export async function executeRun(run: Run): Promise<void> {
  await startActiveObservation("carrier-run", async (runSpan) => {
    runSpan.update({
      input: { run_id: run.id, total_loads: run.loads.length },
      metadata: { run_id: run.id },
    });

    for (const progress of run.loads) {
      progress.status = "in_progress";

      try {
        const load = MOCK_LOADS.find((l) => l.id === progress.load_id)!;

        await startActiveObservation("check-in", async (checkInSpan) => {
          checkInSpan.update({
            input: {
              load_id: load.id,
              carrier: load.carrier_name,
              lane: `${load.origin} → ${load.destination}`,
            },
            metadata: { load_id: load.id, carrier: load.carrier_name },
          });

          const result = await runCheckIn(load, stubForLoad(load));

          checkInSpan.update({
            output: {
              status: result.final_status.status,
              flagged: result.final_status.flagged,
              current_location: result.final_status.current_location,
              eta: result.final_status.eta,
              notes: result.final_status.notes,
            },
            metadata: {
              load_id: load.id,
              carrier: load.carrier_name,
              flagged: String(result.final_status.flagged),
            },
          });
        });

        progress.status = "completed";
      } catch (err) {
        progress.status = "failed";
        progress.error = String(err);
        console.error(`[Run ${run.id}] Load ${progress.load_id} failed:`, err);
      }
    }

    const anyFailed = run.loads.some((l) => l.status === "failed");
    run.status = anyFailed ? "failed" : "completed";
    run.finished_at = new Date().toISOString();

    runSpan.update({
      output: {
        status: run.status,
        completed: run.loads.filter((l) => l.status === "completed").length,
        failed: run.loads.filter((l) => l.status === "failed").length,
      },
    });
  });
}
