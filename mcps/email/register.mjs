import { z } from "zod";

import {
  appendPending,
  loadPending,
  resolvePending,
  appendHistory,
  loadHistory,
} from "../../skill/scripts/store.mjs";
import { loadConfig, requireKeys } from "../shared/config.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";
import {
  formatEmailPreview,
  sendEmail,
  createImapClient,
  listUnread,
  searchMessages,
  readMessage,
  markSeen,
  ImapError,
} from "./helpers.mjs";

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

  // ---------- IMAP reading ----------

  async function withImapClient(fn) {
    const config = loadConfig();
    try {
      const client = createImapClient(config);
      return await fn(client);
    } catch (err) {
      if (err instanceof ImapError) throw err;
      throw new ImapError("IMAP failure: " + err.message, { cause: err });
    }
  }

  server.tool(
    "email_list_unread",
    "List unread messages in the inbox. Returns summaries with UID, from, subject, date, and a 200-char preview. Use email_read to get the full body of a specific message.",
    {
      limit: z.number().int().min(1).max(50).optional().default(10),
      mailbox: z.string().optional().default("INBOX"),
    },
    async ({ limit, mailbox }) => {
      try {
        const messages = await withImapClient((client) =>
          listUnread(client, { limit, mailbox })
        );
        return jsonReply({ count: messages.length, messages });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "email_search",
    "Search the inbox. Any combination of: from, to, subject, body keyword, since (ISO date). Use unseen:true to limit to unread.",
    {
      from: z.string().optional(),
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      since: z
        .string()
        .optional()
        .describe("ISO date or YYYY-MM-DD; matches messages on/after this date"),
      unseen: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
      mailbox: z.string().optional().default("INBOX"),
    },
    async (args) => {
      const { limit, mailbox, ...query } = args;
      try {
        const messages = await withImapClient((client) =>
          searchMessages(client, query, { limit, mailbox })
        );
        return jsonReply({ query, count: messages.length, messages });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "email_read",
    "Fetch the full body of a specific message by UID. Call this after email_list_unread or email_search when the user wants the full text of a message before drafting a reply.",
    {
      uid: z.number().int(),
      mailbox: z.string().optional().default("INBOX"),
    },
    async ({ uid, mailbox }) => {
      try {
        const msg = await withImapClient((client) =>
          readMessage(client, uid, { mailbox })
        );
        if (!msg) return errorReply("No message with UID " + uid);
        return jsonReply(msg);
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "email_mark_read",
    "Mark a message as read (adds the \\\\Seen flag). Useful after processing an email so the user's inbox counter goes down.",
    {
      uid: z.number().int(),
      mailbox: z.string().optional().default("INBOX"),
    },
    async ({ uid, mailbox }) => {
      try {
        await withImapClient((client) => markSeen(client, uid, { mailbox }));
        return jsonReply({ ok: true, uid });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "email_find_stale",
    "Find sent emails that have not received a reply after N days. Uses local history (everything ClaudeCall has sent) — does not cross-reference the real inbox. Useful for 'remind me about unanswered emails'.",
    {
      days: z.number().int().min(1).max(365).optional().default(3),
      limit: z.number().int().min(1).max(50).optional().default(20),
    },
    async ({ days, limit }) => {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const history = loadHistory();
      const sentEmails = history.entries.filter(
        (e) =>
          e.channel === "email" &&
          e.direction === "outbound" &&
          e.status === "sent" &&
          e.timestamp &&
          new Date(e.timestamp).getTime() < cutoff
      );

      // For each sent email, check if there's an inbound message with the
      // same contact after the send date. This uses local history only,
      // so it's a heuristic: if the user hasn't called log_sent on a reply
      // or fetched it via email_list_unread, we won't know about it.
      const stale = [];
      for (const sent of sentEmails) {
        const sentAt = new Date(sent.timestamp).getTime();
        const hasReply = history.entries.some(
          (e) =>
            e.channel === "email" &&
            e.direction === "inbound" &&
            e.contact === sent.contact &&
            new Date(e.timestamp || 0).getTime() > sentAt
        );
        if (!hasReply) stale.push(sent);
        if (stale.length >= limit) break;
      }

      return jsonReply({
        days_threshold: days,
        count: stale.length,
        stale,
        note:
          "This uses local history only. To cross-reference with the real inbox, call email_search with since: <sent date> before interpreting the result.",
      });
    }
  );
}
