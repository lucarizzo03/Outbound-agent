import Anthropic from "@anthropic-ai/sdk";
import { Load, GetCarrierReply, CheckInResult } from "./types.js";
import { logLoadStatus, flagForHuman, getLoadStatus } from "./store.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "log_load_status",
    description:
      "Record the final status of this load after the check-in call. " +
      "MUST be called at the end of every check-in — whether the call went smoothly or there was a problem. " +
      "Calling this tool ends the check-in.",
    input_schema: {
      type: "object" as const,
      properties: {
        load_id: {
          type: "string",
          description: "The load ID",
        },
        current_location: {
          type: "string",
          description: "Current location of the truck as reported by the carrier",
        },
        eta: {
          type: "string",
          description: "Estimated time of arrival at the destination",
        },
        notes: {
          type: "string",
          description:
            "Summary notes from the call. If there was a problem, include it here.",
        },
      },
      required: ["load_id", "current_location", "eta", "notes"],
    },
  },
  {
    name: "flag_for_human",
    description:
      "Flag this load for immediate human attention. Use when the carrier reports a breakdown, accident, " +
      "or major delay they cannot resolve on their own. " +
      "Call this BEFORE log_load_status when there is a serious problem. " +
      "After flagging, wrap up the call professionally and still call log_load_status.",
    input_schema: {
      type: "object" as const,
      properties: {
        load_id: {
          type: "string",
          description: "The load ID",
        },
        reason: {
          type: "string",
          description: "Specific reason this load needs human attention",
        },
      },
      required: ["load_id", "reason"],
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(load: Load): string {
  return `You are an outbound carrier check-in agent for a freight logistics company called HappyRobot.

You are conducting a check-in call for this specific load:
- Load ID: ${load.id}
- Lane: ${load.origin} → ${load.destination}
- Carrier: ${load.carrier_name}

Your protocol — ask ONE question at a time, in this order:
1. Open with a short, friendly greeting. Identify yourself, HappyRobot, and the load ID. Ask for a quick status update.
2. Ask for their current location.
3. Ask for their ETA into ${load.destination}.
4. Ask if there's anything slowing them down or any issues to flag.
5. Call log_load_status to close the call.

If the carrier volunteers information early (e.g. gives their location in the opening reply), skip that question and move to the next one.

When to call flag_for_human:
Flag immediately if the carrier describes anything that requires dispatcher intervention — at any point in the conversation. Judge by meaning, not specific words. Examples:
- "we had a blowout on the trailer, pulled over waiting on roadside" → breakdown, flag it
- "there's a knocking from the engine and I don't think I should keep going" → mechanical risk, flag it
- "got rear-ended about an hour ago, still dealing with police" → accident, flag it

Rules:
- One question per message. Never bundle two questions.
- Keep it short and natural. This is a quick routine call.
- flag_for_human does NOT end the call. After flagging, gather any remaining facts, then call log_load_status.
- Call log_load_status exactly once, at the very end. It ends the check-in.`;
}

// ---------------------------------------------------------------------------
// Carrier reply validation (type-safety guard)
// ---------------------------------------------------------------------------

function validateCarrierReply(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TypeError(
      `getCarrierReply must return a string, got ${typeof raw}`
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("getCarrierReply returned an empty string");
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Main check-in loop
// ---------------------------------------------------------------------------

export async function runCheckIn(
  load: Load,
  getCarrierReply: GetCarrierReply
): Promise<CheckInResult> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Begin the check-in call now." },
  ];

  let statusLogged = false;
  let turnCount = 0;
  const MAX_TURNS = 20;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`CHECK-IN: ${load.id} | ${load.carrier_name}`);
  console.log(`LANE:     ${load.origin} → ${load.destination}`);
  console.log("=".repeat(60));

  while (!statusLogged && turnCount < MAX_TURNS) {
    turnCount++;

    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      system: buildSystemPrompt(load),
      tools: TOOLS,
      messages,
    });

    // Always append the full assistant response to maintain conversation history
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Print any inline text Claude produced alongside the tool call
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          console.log(`\n[Agent] ${block.text.trim()}`);
        }
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === "flag_for_human") {
          const input = toolUse.input as { load_id: string; reason: string };
          flagForHuman(input.load_id, input.reason);

          console.log(`\n[TOOL: flag_for_human]`);
          console.log(`  load_id : ${input.load_id}`);
          console.log(`  reason  : ${input.reason}`);
          console.log(`  → Load flagged. Human dispatcher alerted.`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Load flagged. Human dispatcher has been alerted.",
          });
        } else if (toolUse.name === "log_load_status") {
          const input = toolUse.input as {
            load_id: string;
            current_location: string;
            eta: string;
            notes: string;
          };
          // This is the guaranteed final step — always called at end of every check-in
          logLoadStatus(
            input.load_id,
            input.current_location,
            input.eta,
            input.notes
          );
          statusLogged = true;

          console.log(`\n[TOOL: log_load_status]`);
          console.log(`  load_id          : ${input.load_id}`);
          console.log(`  current_location : ${input.current_location}`);
          console.log(`  eta              : ${input.eta}`);
          console.log(`  notes            : ${input.notes}`);
          console.log(`  → Status logged. Check-in complete.`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Status logged. Check-in complete.",
          });
        }
      }

      // Tool results must be sent back (required by API when stop_reason is "tool_use")
      messages.push({ role: "user", content: toolResults });

      // The loop code controls termination — break as soon as log_load_status fires,
      // not by waiting for the model to stop on its own.
      if (statusLogged) break;

    } else if (response.stop_reason === "end_turn") {
      // Claude produced conversational text (opening, location question, ETA question, etc.)
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const agentMessage = textBlocks.map((b) => b.text).join("\n").trim();

      if (!agentMessage) {
        // Unexpected: no text and no tool call
        break;
      }

      console.log(`\n[Agent → Carrier] ${agentMessage}`);

      // Get carrier reply, validate (type-safety guard), pass straight to agent
      const rawReply = await getCarrierReply(agentMessage);
      const carrierReply = validateCarrierReply(rawReply);

      console.log(`[Carrier → Agent] ${carrierReply}`);
      messages.push({ role: "user", content: carrierReply });
    } else {
      console.log(`[Unexpected stop_reason: ${response.stop_reason}]`);
      break;
    }
  }

  if (!statusLogged) {
    // Loop exited without log_load_status — hit turn cap or unexpected break.
    // Force-log an incomplete record so the load store always has an entry
    // and a dispatcher knows to follow up rather than the load silently disappearing.
    const partial = getLoadStatus(load.id); // may have partial data from a prior flag_for_human
    flagForHuman(
      load.id,
      `Check-in incomplete — loop exited after ${turnCount} turns without gathering all required information`
    );
    logLoadStatus(
      load.id,
      partial?.current_location ?? "Unknown",
      partial?.eta ?? "Unknown",
      `Check-in incomplete — exited after ${turnCount} turns. Manual follow-up required.`
    );
    console.warn(
      `\n[WARN] Load ${load.id} — check-in did not complete within ${MAX_TURNS} turns. Force-logged and flagged for human.`
    );
  }

  const finalStatus = getLoadStatus(load.id);
  if (!finalStatus) {
    throw new Error(
      `[ASSERT] store has no record for ${load.id} after log was written.`
    );
  }

  return {
    load_id: load.id,
    status_logged: true,
    final_status: finalStatus,
  };
}
