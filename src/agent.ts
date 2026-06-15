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

Your protocol:
1. Open the call by briefly identifying yourself, the company, and the load.
2. Gather the two required facts, asking ONE question at a time:
   - Current location of the truck
   - Estimated time of arrival (ETA) at the destination
3. If the carrier describes any situation that prevents or seriously threatens on-time delivery and that they cannot resolve on their own, call flag_for_human immediately.
4. At the end of EVERY call — smooth or escalated — call log_load_status with the location, ETA, and notes.

When to call flag_for_human:
Judge by the meaning of what the carrier says, not specific words. Flag the load any time a competent dispatcher would want to know about it right away. Examples:
- "I blew a tire and I'm stuck on the shoulder waiting for roadside" → breakdown, flag it
- "There's a loud knocking from the engine — I'm not sure I should keep going" → mechanical risk, flag it
- "I got into an accident about an hour ago, still dealing with it" → accident, flag it

Rules:
- Ask exactly one question per message. Never bundle multiple questions.
- Be professional and concise. Keep messages short.
- flag_for_human does NOT end the call. After flagging, finish gathering any facts you still need, then call log_load_status.
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

  // Belt-and-suspenders assertion — this should never fire in normal operation
  if (!statusLogged) {
    throw new Error(
      `[ASSERT] Check-in for load ${load.id} ended after ${turnCount} turns ` +
        `without calling log_load_status. Status was never logged.`
    );
  }

  const finalStatus = getLoadStatus(load.id);
  if (!finalStatus) {
    throw new Error(
      `[ASSERT] log_load_status was called but store has no record for ${load.id}.`
    );
  }

  return {
    load_id: load.id,
    status_logged: true,
    final_status: finalStatus,
  };
}
