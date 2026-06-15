import { MOCK_LOADS } from "./mockData.js";
import { runCheckIn } from "./agent.js";
import { stubForLoad } from "./stubs.js";

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
  for (const progress of run.loads) {
    progress.status = "in_progress";

    try {
      const load = MOCK_LOADS.find((l) => l.id === progress.load_id)!;
      await runCheckIn(load, stubForLoad(load));
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
}
