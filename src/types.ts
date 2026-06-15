export interface Load {
  id: string;
  origin: string;
  destination: string;
  carrier_name: string;
}

export interface LoadStatus {
  load_id: string;
  current_location: string | null;
  eta: string | null;
  notes: string;
  flagged: boolean;
  flag_reason: string | null;
  status: "pending" | "completed" | "needs_attention";
  updated_at: string;
}

export type GetCarrierReply = (agentMessage: string) => Promise<string>;

export interface CheckInResult {
  load_id: string;
  status_logged: boolean;
  final_status: LoadStatus;
}
