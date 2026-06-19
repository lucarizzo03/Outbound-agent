import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LoadMeta {
  id: string;
  origin: string;
  destination: string;
  carrier_name: string;
}

interface LoadStatus {
  load_id: string;
  current_location: string | null;
  eta: string | null;
  notes: string;
  flagged: boolean;
  flag_reason: string | null;
  status: "pending" | "completed" | "needs_attention";
  updated_at: string;
}

interface LoadProgress {
  load_id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

interface RunData {
  run_id: string;
  status: "in_progress" | "completed" | "failed";
  loads: LoadProgress[];
  started_at: string;
  finished_at: string | null;
}

interface TranscriptTurn {
  id: number;
  role: "agent" | "carrier" | "tool";
  content: string;
  toolName?: "flag_for_human" | "log_load_status";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_MS = 750;

// ── Helpers ───────────────────────────────────────────────────────────────────

function jitter(base: number, spread: number) {
  return base + Math.random() * spread;
}

function revealDelay(turn: TranscriptTurn, replay: boolean): number {
  if (replay) return jitter(90, 80);
  if (turn.role === "tool") return jitter(120, 80);
  if (turn.role === "carrier") return jitter(950, 500);
  return jitter(500, 350);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Status dot
function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"    ? "var(--green)"  :
    status === "in_progress"  ? "var(--amber)"  :
    status === "needs_attention" || status === "failed" ? "var(--red)" :
    "var(--border-mid)";

  const pulse = status === "in_progress";

  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        animation: pulse ? "status-pulse 1.4s ease-in-out infinite" : "none",
      }}
    />
  );
}

// Status label pill
function StatusLabel({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending:         "Pending",
    in_progress:     "In Progress",
    completed:       "Completed",
    failed:          "Failed",
    needs_attention: "Needs Attention",
  };

  const colors: Record<string, { color: string; bg: string }> = {
    pending:         { color: "var(--text-3)",  bg: "transparent" },
    in_progress:     { color: "var(--amber)",   bg: "#fef3c7" },
    completed:       { color: "var(--green)",   bg: "#f0fdf4" },
    failed:          { color: "var(--red)",     bg: "var(--red-bg)" },
    needs_attention: { color: "var(--red)",     bg: "var(--red-bg)" },
  };

  const { color, bg } = colors[status] ?? colors.pending;

  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color,
        background: bg,
        borderRadius: 4,
        padding: "2px 7px",
        letterSpacing: "0.01em",
        transition: "all 0.4s ease",
      }}
    >
      {labels[status] ?? status}
    </span>
  );
}

// Typing indicator bubble
function TypingIndicator({ side }: { side: "agent" | "carrier" }) {
  const isAgent = side === "agent";
  return (
    <div
      className="bubble-in"
      style={{
        display: "flex",
        justifyContent: isAgent ? "flex-end" : "flex-start",
        padding: "2px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 14px",
          borderRadius: isAgent
            ? "var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble)"
            : "var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 4px",
          background: isAgent ? "var(--accent)" : "#ebebea",
          color: isAgent ? "#fff" : "var(--text-2)",
        }}
      >
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

// Single conversation turn
function Turn({ turn }: { turn: TranscriptTurn }) {
  const isAgent   = turn.role === "agent";
  const isCarrier = turn.role === "carrier";
  const isTool    = turn.role === "tool";

  if (isTool) {
    const isFlag = turn.toolName === "flag_for_human";
    return (
      <div
        className="bubble-in"
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "6px 0",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: isFlag ? "var(--red)" : "var(--text-3)",
            background: isFlag ? "var(--red-bg)" : "#f3f3f2",
            border: `1px solid ${isFlag ? "var(--red-border)" : "var(--border)"}`,
            borderRadius: 100,
            padding: "4px 12px",
            fontWeight: 500,
            letterSpacing: "0.01em",
          }}
        >
          {isFlag ? `⚑ Flagged for dispatcher — ${turn.content}` : "✓ Status logged"}
        </span>
      </div>
    );
  }

  return (
    <div
      className="bubble-in"
      style={{
        display: "flex",
        justifyContent: isAgent ? "flex-end" : "flex-start",
        padding: "2px 0",
      }}
    >
      <div
        style={{
          maxWidth: "72%",
          padding: "10px 14px",
          borderRadius: isAgent
            ? "var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble)"
            : "var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 4px",
          background: isAgent ? "var(--accent)" : "#ebebea",
          color: isAgent ? "#fff" : "var(--text)",
          lineHeight: 1.5,
          fontSize: 14,
        }}
      >
        {turn.content}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [metaLoads, setMetaLoads] = useState<LoadMeta[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runData, setRunData] = useState<RunData | null>(null);
  const [loadStatuses, setLoadStatuses] = useState<Record<string, LoadStatus>>({});
  const [starting, setStarting] = useState(false);

  // ── Selection state ──────────────────────────────────────────────────────────
  // manualPick: user explicitly clicked a row — freeze auto-follow
  const [manualPick, setManualPick] = useState<string | null>(null);

  // ── Transcript + reveal state ────────────────────────────────────────────────
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptTurn[]>>({});
  const [revealedCounts, setRevealedCounts] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<{ loadId: string; side: "agent" | "carrier" } | null>(null);

  // revealed flags: which loads have had their flag_for_human turn revealed
  const [revealedFlags, setRevealedFlags] = useState<Record<string, boolean>>({});

  // replay mode per load: true if load was already completed when first selected
  const replayModeRef = useRef<Record<string, boolean>>({});

  // Prevent re-triggering reveal while timer is active
  const revealActiveRef = useRef(false);

  // Auto-scroll ref for conversation panel
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Derived: which load is "selected" ────────────────────────────────────────
  const autoId = runData?.loads.find((l) => l.status === "in_progress")?.load_id ?? null;
  const selectedId = manualPick ?? autoId ?? metaLoads[0]?.id ?? null;

  // ── Load metadata once on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/loads/meta")
      .then((r) => r.json())
      .then(setMetaLoads)
      .catch(console.error);
  }, []);

  // ── Main polling loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!runId) return;

    const poll = async () => {
      try {
        const [runRes, loadsRes] = await Promise.all([
          fetch(`/api/run/${runId}`),
          fetch("/api/loads"),
        ]);
        const run: RunData = await runRes.json();
        const statuses: LoadStatus[] = await loadsRes.json();

        setRunData(run);

        const map: Record<string, LoadStatus> = {};
        for (const s of statuses) map[s.load_id] = s;
        setLoadStatuses(map);

        // Fetch transcripts for every load that has started
        const started = run.loads.filter((l) => l.status !== "pending").map((l) => l.load_id);
        if (started.length > 0) {
          const results = await Promise.all(
            started.map((id) => fetch(`/api/loads/${id}/transcript`).then((r) => r.json()))
          );
          setTranscripts((prev) => {
            const next = { ...prev };
            started.forEach((id, i) => { next[id] = results[i]; });
            return next;
          });
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [runId]);

  // ── Reveal effect — fires when selected load has unrevealed turns ─────────────
  const selectedTranscript = selectedId ? (transcripts[selectedId] ?? []) : [];
  const selectedRevealed   = selectedId ? (revealedCounts[selectedId] ?? 0) : 0;
  const available          = selectedTranscript.length;

  useEffect(() => {
    if (!selectedId) return;
    if (selectedRevealed >= available) {
      setTyping(null);
      revealActiveRef.current = false;
      return;
    }

    // Don't restart the timer if one is already running
    if (revealActiveRef.current) return;
    revealActiveRef.current = true;

    const nextTurn = selectedTranscript[selectedRevealed];
    if (!nextTurn) { revealActiveRef.current = false; return; }

    const isReplay = replayModeRef.current[selectedId] === true;

    // Show typing indicator for dialogue turns
    if (nextTurn.role === "agent" || nextTurn.role === "carrier") {
      setTyping({ loadId: selectedId, side: nextTurn.role });
    } else {
      setTyping(null);
    }

    const delay = revealDelay(nextTurn, isReplay);

    const timer = setTimeout(() => {
      revealActiveRef.current = false;
      setTyping(null);
      setRevealedCounts((prev) => ({
        ...prev,
        [selectedId]: (prev[selectedId] ?? 0) + 1,
      }));
      // Track when a flag event is revealed → syncs board row
      if (nextTurn.toolName === "flag_for_human") {
        setRevealedFlags((prev) => ({ ...prev, [selectedId]: true }));
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      revealActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, available, selectedRevealed]);

  // ── Auto-scroll to bottom as turns appear ────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedRevealed, typing]);

  // ── Select a load (user-initiated) ──────────────────────────────────────────
  const handleSelect = useCallback(
    (id: string) => {
      if (id === selectedId) return;

      // Cancel any active reveal for current load
      revealActiveRef.current = false;
      setTyping(null);

      setManualPick(id);

      // Determine replay mode for the newly-selected load
      const progress = runData?.loads.find((l) => l.load_id === id);
      const alreadyDone =
        progress?.status === "completed" || progress?.status === "failed";
      const nothingRevealed = (revealedCounts[id] ?? 0) === 0;
      replayModeRef.current[id] = alreadyDone && nothingRevealed;
    },
    [selectedId, runData, revealedCounts]
  );

  // ── Start a run ──────────────────────────────────────────────────────────────
  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/run", { method: "POST" });
      const data = await res.json();
      setRunId(data.run_id);
      setTranscripts({});
      setRevealedCounts({});
      setRevealedFlags({});
      setManualPick(null);
      replayModeRef.current = {};
    } catch (e) {
      console.error("Start failed:", e);
    } finally {
      setStarting(false);
    }
  };

  // ── Derive display state for each load ───────────────────────────────────────
  function progressStatus(id: string): LoadProgress["status"] {
    return runData?.loads.find((l) => l.load_id === id)?.status ?? "pending";
  }

  // Board row red state:
  // - For the selected load: only flip when the flag turn has been revealed (keeps sync)
  // - For other loads: use backend status directly
  function isEscalated(id: string): boolean {
    if (id === selectedId) return revealedFlags[id] === true;
    return (
      loadStatuses[id]?.flagged === true ||
      loadStatuses[id]?.status === "needs_attention"
    );
  }

  // ── Selected load info ───────────────────────────────────────────────────────
  const selectedMeta   = metaLoads.find((l) => l.id === selectedId);
  const selectedStatus = selectedId ? loadStatuses[selectedId] : null;
  const selectedProg   = selectedId ? progressStatus(selectedId) : "pending";

  const visibleTurns = selectedId
    ? (transcripts[selectedId] ?? []).slice(0, revealedCounts[selectedId] ?? 0)
    : [];

  const showTyping =
    typing !== null &&
    typing.loadId === selectedId &&
    (typing.side === "agent" || typing.side === "carrier");

  const runDone = runData?.status === "completed" || runData?.status === "failed";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "var(--panel)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            H
          </span>
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
            Outbound Agent
          </span>
          <span
            style={{
              color: "var(--border-mid)",
              fontSize: 16,
              margin: "0 2px",
            }}
          >
            /
          </span>
          <span style={{ color: "var(--text-2)", fontSize: 14 }}>
            Carrier Check-In
          </span>
        </div>

        <button
          onClick={handleStart}
          disabled={starting || (!!runId && !runDone)}
          style={{
            padding: "7px 16px",
            borderRadius: 7,
            border: "none",
            background:
              runDone ? "#f0fdf4" :
              starting || (runId && !runDone) ? "#e8e8e6" :
              "var(--accent)",
            color:
              runDone ? "var(--green)" :
              starting || (runId && !runDone) ? "var(--text-3)" :
              "#fff",
            fontWeight: 500,
            fontSize: 13,
            cursor: starting || (!!runId && !runDone) ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 7,
            transition: "background 0.3s, color 0.3s",
            fontFamily: "inherit",
          }}
        >
          {runDone ? (
            <>✓ Run Complete</>
          ) : starting ? (
            "Starting…"
          ) : runId ? (
            <>
              <RunningSpinner />
              Running…
            </>
          ) : (
            "Start Check-In Run"
          )}
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ── Left: Load board ─────────────────────────────────────────────── */}
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            background: "var(--panel)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 20px 10px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--text-3)",
              }}
            >
              Active Loads
            </span>
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                color: "var(--text-3)",
                fontWeight: 500,
              }}
            >
              {metaLoads.length}
            </span>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {metaLoads.map((load) => {
              const prog      = progressStatus(load.id);
              const escalated = isEscalated(load.id);
              const selected  = load.id === selectedId;

              return (
                <LoadRow
                  key={load.id}
                  load={load}
                  prog={prog}
                  escalated={escalated}
                  selected={selected}
                  onClick={() => handleSelect(load.id)}
                />
              );
            })}
          </div>
        </aside>

        {/* ── Right: Conversation panel ─────────────────────────────────────── */}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--bg)",
          }}
        >
          {selectedMeta ? (
            <>
              {/* Panel header */}
              <div
                style={{
                  padding: "14px 28px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--panel)",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--text)",
                      }}
                    >
                      {selectedMeta.id}
                    </span>
                    <span
                      style={{
                        color: "var(--text-3)",
                        fontSize: 13,
                      }}
                    >
                      ·
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                      {selectedMeta.carrier_name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    {selectedMeta.origin} → {selectedMeta.destination}
                  </div>
                </div>
                <StatusLabel
                  status={
                    isEscalated(selectedMeta.id)
                      ? "needs_attention"
                      : selectedProg
                  }
                />
              </div>

              {/* Conversation thread */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 28px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {selectedProg === "pending" && visibleTurns.length === 0 && !showTyping ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div style={{ textAlign: "center", color: "var(--text-3)" }}>
                      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>○</div>
                      <div style={{ fontSize: 13 }}>Waiting to start</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {visibleTurns.map((turn) => (
                      <Turn key={turn.id} turn={turn} />
                    ))}
                    {showTyping && typing && (
                      <TypingIndicator side={typing.side} />
                    )}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>

              {/* Load status footer (when completed) */}
              {selectedStatus && selectedProg !== "in_progress" && (
                <div
                  style={{
                    borderTop: "1px solid var(--border)",
                    background: "var(--panel)",
                    padding: "12px 28px",
                    display: "flex",
                    gap: 28,
                    flexShrink: 0,
                  }}
                >
                  <FooterField label="Location" value={selectedStatus.current_location} />
                  <FooterField label="ETA" value={selectedStatus.eta} />
                  {selectedStatus.flagged && selectedStatus.flag_reason && (
                    <FooterField
                      label="Flag"
                      value={selectedStatus.flag_reason}
                      red
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              Select a load to view its conversation
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── LoadRow ───────────────────────────────────────────────────────────────────

interface LoadRowProps {
  load: LoadMeta;
  prog: LoadProgress["status"];
  escalated: boolean;
  selected: boolean;
  onClick: () => void;
}

function LoadRow({ load, prog, escalated, selected, onClick }: LoadRowProps) {
  const prevEscalated = useRef(false);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (escalated && !prevEscalated.current) {
      setPulseKey((k) => k + 1);
    }
    prevEscalated.current = escalated;
  }, [escalated]);

  const bg = escalated
    ? "var(--red-bg)"
    : selected
    ? "var(--selected-bg)"
    : "var(--panel)";

  const borderLeft = escalated
    ? "3px solid var(--red)"
    : selected
    ? "3px solid var(--accent)"
    : "3px solid transparent";

  const displayStatus = escalated ? "needs_attention" : prog;

  return (
    <div
      key={pulseKey > 0 ? `pulse-${pulseKey}` : undefined}
      className={pulseKey > 0 ? "escalation-pulse" : undefined}
      onClick={onClick}
      style={{
        padding: "14px 20px 14px 17px",
        borderBottom: "1px solid var(--border)",
        borderLeft,
        background: bg,
        cursor: "pointer",
        transition: "background 0.35s ease, border-left-color 0.35s ease",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot status={displayStatus} />
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: escalated ? "var(--red)" : "var(--text)",
              transition: "color 0.35s ease",
            }}
          >
            {load.id}
          </span>
        </div>
        <StatusLabel status={displayStatus} />
      </div>
      <div style={{ paddingLeft: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 2 }}>
          {load.carrier_name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          {load.origin} → {load.destination}
        </div>
      </div>
    </div>
  );
}

// ── FooterField ───────────────────────────────────────────────────────────────

function FooterField({
  label,
  value,
  red,
}: {
  label: string;
  value: string | null;
  red?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: red ? "var(--red)" : "var(--text-3)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: red ? "var(--red)" : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

// ── RunningSpinner ────────────────────────────────────────────────────────────

function RunningSpinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "spin 0.9s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
