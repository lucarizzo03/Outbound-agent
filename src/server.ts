import "./instrumentation.js";
import express from "express";
import cors from "cors";
import { sdk } from "./instrumentation.js";
import { createRun, executeRun, getRun } from "./runs.js";
import { getAllStatuses, getLoadStatus } from "./store.js";
import { getTranscript } from "./transcriptStore.js";
import { MOCK_LOADS } from "./mockData.js";

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// POST /run
// Starts a sequential check-in run across all loads.
// Returns immediately with a run ID — client polls GET /run/:runId for status.
// ---------------------------------------------------------------------------
app.post("/run", (_req, res) => {
  const run = createRun();

  executeRun(run).catch((err) => {
    run.status = "failed";
    run.finished_at = new Date().toISOString();
    console.error(`[Run ${run.id}] Unexpected error:`, err);
  });

  res.status(202).json({
    run_id: run.id,
    status: run.status,
    total: run.loads.length,
  });
});

// ---------------------------------------------------------------------------
// GET /run/:runId
// Poll the status of a run. Returns per-load progress and aggregate counts.
// ---------------------------------------------------------------------------
app.get("/run/:runId", (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: `Run ${req.params.runId} not found` });
    return;
  }

  const progress = {
    pending:     run.loads.filter((l) => l.status === "pending").length,
    in_progress: run.loads.filter((l) => l.status === "in_progress").length,
    completed:   run.loads.filter((l) => l.status === "completed").length,
    failed:      run.loads.filter((l) => l.status === "failed").length,
  };

  res.json({
    run_id:      run.id,
    status:      run.status,
    progress,
    loads:       run.loads,
    started_at:  run.started_at,
    finished_at: run.finished_at ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /loads
// Returns all load statuses currently in the store.
// ---------------------------------------------------------------------------
app.get("/loads", (_req, res) => {
  res.json(getAllStatuses());
});

// ---------------------------------------------------------------------------
// GET /loads/meta
// Returns static load metadata (id, origin, destination, carrier_name).
// Must be registered before /loads/:id to avoid the :id wildcard catching it.
// ---------------------------------------------------------------------------
app.get("/loads/meta", (_req, res) => {
  res.json(MOCK_LOADS);
});

// ---------------------------------------------------------------------------
// GET /loads/:id/transcript
// Returns the conversation transcript for a load, built turn-by-turn.
// ---------------------------------------------------------------------------
app.get("/loads/:id/transcript", (req, res) => {
  res.json(getTranscript(req.params.id));
});

// ---------------------------------------------------------------------------
// GET /loads/:id
// Returns the status for a single load, or 404 if not yet checked in.
// ---------------------------------------------------------------------------
app.get("/loads/:id", (req, res) => {
  const status = getLoadStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: `Load ${req.params.id} not found` });
    return;
  }
  res.json(status);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Outbound Agent API → http://localhost:${PORT}`);
  console.log(`  POST /run           start a check-in run`);
  console.log(`  GET  /run/:runId    poll run status`);
  console.log(`  GET  /loads         all load statuses`);
  console.log(`  GET  /loads/:id     single load status`);
});

process.on("SIGTERM", () => sdk.shutdown().finally(() => process.exit(0)));
process.on("SIGINT",  () => sdk.shutdown().finally(() => process.exit(0)));

export default app;
