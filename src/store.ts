import { LoadStatus } from "./types.js";

const store = new Map<string, LoadStatus>();

export function logLoadStatus(
  loadId: string,
  currentLocation: string,
  eta: string,
  notes: string
): void {
  const existing = store.get(loadId);
  store.set(loadId, {
    load_id: loadId,
    current_location: currentLocation,
    eta,
    notes,
    flagged: existing?.flagged ?? false,
    flag_reason: existing?.flag_reason ?? null,
    status: existing?.flagged ? "needs_attention" : "completed",
    updated_at: new Date().toISOString(),
  });
}

export function flagForHuman(loadId: string, reason: string): void {
  const existing = store.get(loadId);
  store.set(loadId, {
    load_id: loadId,
    current_location: existing?.current_location ?? null,
    eta: existing?.eta ?? null,
    notes: existing?.notes ?? "",
    flagged: true,
    flag_reason: reason,
    status: "needs_attention",
    updated_at: new Date().toISOString(),
  });
}

export function getLoadStatus(loadId: string): LoadStatus | undefined {
  return store.get(loadId);
}

export function getAllStatuses(): LoadStatus[] {
  return Array.from(store.values());
}
