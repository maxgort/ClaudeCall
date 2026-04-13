import { z } from "zod";

import {
  appendPending,
  loadPending,
  resolvePending,
  appendHistory,
} from "../../skill/scripts/store.mjs";
import { loadConfig, requireKeys } from "../shared/config.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";
import {
  listScenarios,
  loadScenarioBody,
  isValidScenarioName,
  formatVoicePreview,
  createVapiCall,
  getVapiCallResult,
  VapiError,
  SCENARIO_NAME_RE,
} from "./helpers.mjs";

export function registerVoiceTools(server) {
  const scenarioSchema = z
    .string()
    .regex(
      SCENARIO_NAME_RE,
      "scenario must be lowercase letters, digits, underscores only"
    )
    .optional();

  server.tool(
    "voice_list_scenarios",
    "List available pre-baked call scenarios. Call this first when the user asks for a call that might match a known template.",
    {},
    async () => jsonReply({ scenarios: listScenarios() })
  );

  server.tool(
    "voice_preview",
    "Create a pending voice-call draft. Returns a pending_id and the script that will be spoken. Show to user, wait for approval, then call voice_create_call.",
    {
      to_number: z
        .string()
        .describe("E.164 phone number to call, e.g. +15551234567"),
      scenario: scenarioSchema.describe(
        "Name of a scenario from skill/scenarios/ (lowercase, digits, underscores)."
      ),
      caller_name: z.string().optional(),
      callback_number: z.string().optional(),
      variables: z
        .record(z.string(), z.any())
        .optional()
        .describe("Values to substitute into the scenario's {{ placeholders }}."),
      freeform_prompt: z
        .string()
        .optional()
        .describe(
          "Used when no scenario fits — raw instructions for the voice agent."
        ),
    },
    async (payload) => {
      if (payload.scenario && !isValidScenarioName(payload.scenario)) {
        return errorReply("Invalid scenario name: " + payload.scenario);
      }
      const scenarioBody = payload.scenario
        ? loadScenarioBody(payload.scenario)
        : null;
      if (payload.scenario && !scenarioBody) {
        return errorReply(
          "Unknown scenario: " +
            payload.scenario +
            ". Call voice_list_scenarios to see options."
        );
      }

      const row = appendPending({
        channel: "voice",
        action: "create_call",
        payload,
      });

      return jsonReply({
        pending_id: row.id,
        preview: formatVoicePreview(payload, scenarioBody),
        instructions:
          "Show this preview to the user. Wait for explicit approval before calling voice_create_call. Voice calls cost money — be extra careful.",
      });
    }
  );

  server.tool(
    "voice_create_call",
    "Place a previously-previewed outbound call through Vapi. Only call after explicit user approval of the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply(
          "Pending row is already " + pending.status + " and cannot be sent."
        );
      }
      if (pending.channel !== "voice") {
        return errorReply("Pending row is not a voice action.");
      }

      let config;
      try {
        config = loadConfig();
        requireKeys(
          config,
          ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID"],
          "voice"
        );
      } catch (err) {
        return errorReply(err.message);
      }

      const p = pending.payload;
      const scenarioBody = p.scenario ? loadScenarioBody(p.scenario) : null;

      try {
        const { call_id, status, script } = await createVapiCall(
          config,
          p,
          scenarioBody
        );

        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "voice",
          contact: p.to_number,
          direction: "outbound",
          summary: "Call placed" + (p.scenario ? " — " + p.scenario : ""),
          content: script,
          status: "sent",
          provider_call_id: call_id,
        });

        return jsonReply({ ok: true, call_id, status });
      } catch (err) {
        appendHistory({
          channel: "voice",
          contact: p.to_number,
          direction: "outbound",
          summary: "Call attempt" + (p.scenario ? " — " + p.scenario : ""),
          status: "failed",
          error: err.message,
        });
        if (err instanceof VapiError) {
          return errorReply(err.message);
        }
        return errorReply("Vapi request failed: " + err.message);
      }
    }
  );

  server.tool(
    "voice_cancel",
    "Cancel a pending voice call draft. Call when the user rejects the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const row = resolvePending(pending_id, "cancelled");
      if (!row) return errorReply("No pending row with id " + pending_id);
      return jsonReply({ ok: true, cancelled: row.id });
    }
  );

  server.tool(
    "voice_get_call_result",
    "Fetch the status, transcript, summary, and recording URL of a previously-placed call. Call this after voice_create_call to retrieve the conversation result. If the status is 'queued' or 'in-progress', wait ~15-30 seconds and call again.",
    { call_id: z.string() },
    async ({ call_id }) => {
      let config;
      try {
        config = loadConfig();
        requireKeys(config, ["VAPI_API_KEY"], "voice");
      } catch (err) {
        return errorReply(err.message);
      }

      try {
        const result = await getVapiCallResult(config, call_id);
        // If the call has ended, append the transcript/summary to history
        // so future query_history calls can surface it.
        if (
          result.status === "ended" &&
          (result.transcript || result.summary)
        ) {
          appendHistory({
            channel: "voice",
            contact: call_id,
            direction: "inbound",
            summary: result.summary || "Call transcript",
            content: result.transcript || "",
            status: "sent",
            provider_call_id: call_id,
            duration_seconds: result.duration_seconds,
            recording_url: result.recording_url,
          });
        }
        return jsonReply(result);
      } catch (err) {
        if (err instanceof VapiError) return errorReply(err.message);
        return errorReply("Vapi lookup failed: " + err.message);
      }
    }
  );
}
