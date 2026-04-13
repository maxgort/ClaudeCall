import { z } from "zod";

import {
  appendPending,
  loadPending,
  resolvePending,
  appendHistory,
} from "../../skill/scripts/store.mjs";
import { loadConfig, requireKeys } from "../shared/config.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";
import { formatEmailPreview, sendEmail } from "./helpers.mjs";

export function registerEmailTools(server) {
  const payloadSchema = {
    to: z.string().email().describe("Recipient email address."),
    cc: z.string().email().optional(),
    bcc: z.string().email().optional(),
    subject: z.string().min(1),
    body: z
      .string()
      .min(1)
      .describe("Plain-text body. Include signature from profile."),
    reply_to_message_id: z.string().optional(),
  };

  server.tool(
    "email_preview",
    "Create a pending email draft. Returns a pending_id and a human-readable preview. Show the preview to the user in a code block and wait for explicit approval before calling email_send.",
    payloadSchema,
    async (payload) => {
      const row = appendPending({
        channel: "email",
        action: "send",
        payload,
      });
      return jsonReply({
        pending_id: row.id,
        preview: formatEmailPreview(payload),
        instructions:
          "Show this preview to the user in a code block. Wait for explicit 'ok'/'send'/'approve' before calling email_send. On rejection call email_cancel.",
      });
    }
  );

  server.tool(
    "email_send",
    "Actually send a previously-previewed email. Only call this after the user has explicitly approved the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply(
          "Pending row is already " + pending.status + " and cannot be sent."
        );
      }
      if (pending.channel !== "email") {
        return errorReply("Pending row is not an email action.");
      }

      let config;
      try {
        config = loadConfig();
        requireKeys(config, ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"], "email");
      } catch (err) {
        return errorReply(err.message);
      }

      const p = pending.payload;
      try {
        const info = await sendEmail(config, p);

        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "email",
          contact: p.to,
          direction: "outbound",
          summary: p.subject,
          content: p.body,
          status: "sent",
          provider_message_id: info.messageId,
        });

        return jsonReply({
          ok: true,
          message_id: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        });
      } catch (err) {
        appendHistory({
          channel: "email",
          contact: p.to,
          direction: "outbound",
          summary: p.subject,
          content: p.body,
          status: "failed",
          error: err.message,
        });
        return errorReply("SMTP send failed: " + err.message);
      }
    }
  );

  server.tool(
    "email_cancel",
    "Cancel a pending email draft. Call this when the user rejects the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const row = resolvePending(pending_id, "cancelled");
      if (!row) return errorReply("No pending row with id " + pending_id);
      return jsonReply({ ok: true, cancelled: row.id });
    }
  );
}
