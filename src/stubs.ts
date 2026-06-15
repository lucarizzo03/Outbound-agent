import { Load, GetCarrierReply } from "./types.js";

// Per-load clean responses — casual trucker language, route-appropriate locations
const CLEAN_RESPONSES: Record<string, [string, string, string]> = {
  "LOAD-001": [
    "yeah we're rolling, just passed Waco",
    "probably around 4pm today",
    "all good, smooth so far",
  ],
  "LOAD-002": [
    "just hit Blythe, maybe 40 minutes out from Phoenix",
    "should be there around 2pm",
    "all clear, easy drive",
  ],
  "LOAD-003": [
    "we're on I-45, just passed Corsicana",
    "probably noon, maybe a little before",
    "no issues, cruising along",
  ],
  "LOAD-004": [
    "just crossed the state line into Oregon",
    "about 45 minutes out from Portland",
    "all good, light traffic",
  ],
};

const FALLBACK_CLEAN: [string, string, string] = [
  "yeah we're moving, making good time",
  "should be there on schedule",
  "all good, no issues",
];

export function makeCleanStub(load: Load): GetCarrierReply {
  const [locationReply, etaReply, issuesReply] =
    CLEAN_RESPONSES[load.id] ?? FALLBACK_CLEAN;
  let turn = 0;
  return async (_agentMessage: string): Promise<string> => {
    turn++;
    if (turn === 1) return locationReply;
    if (turn === 2) return etaReply;
    if (turn === 3) return issuesReply;
    return "yeah that's right";
  };
}

export function makeEscalationStub(_load: Load): GetCarrierReply {
  let turn = 0;
  return async (_agentMessage: string): Promise<string> => {
    turn++;
    if (turn === 1)
      return "actually we had a blowout on the trailer, pulled over just outside Spartanburg, waiting on roadside";
    if (turn === 2)
      return "we're on I-85, mile marker 85, just outside Spartanburg";
    if (turn === 3)
      return "probably 4 or 5 hours out from Charlotte, depends when roadside shows up";
    return "yeah understood, appreciate it";
  };
}

// LOAD-005 is the designated escalation load — all others get the clean stub
export function stubForLoad(load: Load): GetCarrierReply {
  return load.id === "LOAD-005"
    ? makeEscalationStub(load)
    : makeCleanStub(load);
}
