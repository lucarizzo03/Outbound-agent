export type TurnRole = "agent" | "carrier" | "tool";
export type ToolName = "flag_for_human" | "log_load_status";

export interface TranscriptTurn {
  id: number;
  role: TurnRole;
  content: string;
  toolName?: ToolName;
}

const transcripts = new Map<string, TranscriptTurn[]>();
let seq = 0;

export function addTurn(
  loadId: string,
  role: TurnRole,
  content: string,
  toolName?: ToolName
): void {
  if (!transcripts.has(loadId)) transcripts.set(loadId, []);
  transcripts.get(loadId)!.push({ id: seq++, role, content, toolName });
}

export function getTranscript(loadId: string): TranscriptTurn[] {
  return transcripts.get(loadId) ?? [];
}
