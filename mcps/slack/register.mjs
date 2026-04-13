import { z } from "zod";

import {
  appendPending,
  loadPending,
  resolvePending,
  appendHistory,
} from "../../skill/scripts/store.mjs";
import { loadConfig } from "../shared/config.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";
import {
  formatSlackPreview,
  resolveSlackChannel,
  sendSlackMessage,
  listSlackChannels,
  findSlackUser,
  readSlackHistory,
  SlackError,
} from "./helpers.mjs";

export function registerSlackTools(server) {
  server.tool(
    "slack_preview",
    "Create a pending Slack message draft. Resolves the channel to a human label (#general, @alex) and waits for approval before calling slack_send.",
    {
      channel: z
        .string()
        .describe(
          "#channel-name, @username for DM, or a raw channel ID (CXXXX)."
        ),
      text: z.string().min(1),
      thread_ts: z
        .string()
        .optional()
        .describe("Optional: reply inside a thread"),
    },
    async (payload) => {
      try {
        const config = loadConfig();
        const resolved = await resolveSlackChannel(config, payload.channel);
        const row = appendPending({
          channel: "slack",
          action: "send",
          payload: { ...payload, resolved_channel_name: resolved.name },
        });
        return jsonReply({
          pending_id: row.id,
          preview: formatSlackPreview({
            ...payload,
            resolved_channel_name: resolved.name,
          }),
          instructions:
            "Show this preview to the user. Wait for explicit 'ok'/'send'/'approve' before calling slack_send.",
        });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "slack_send",
    "Send a previously-previewed Slack message. Only call after explicit user approval.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply(
          "Pending row is already " + pending.status + " and cannot be sent."
        );
      }
      if (pending.channel !== "slack") {
        return errorReply("Pending row is not a slack action.");
      }

      const p = pending.payload;
      try {
        const config = loadConfig();
        const { message_ts, channel_label } = await sendSlackMessage(config, p);

        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "slack",
          contact: channel_label,
          direction: "outbound",
          summary: p.text.slice(0, 80),
          content: p.text,
          status: "sent",
          provider_message_id: message_ts,
        });
        return jsonReply({ ok: true, message_ts, channel_label });
      } catch (err) {
        appendHistory({
          channel: "slack",
          contact: p.resolved_channel_name || String(p.channel),
          direction: "outbound",
          summary: p.text.slice(0, 80),
          content: p.text,
          status: "failed",
          error: err.message,
        });
        if (err instanceof SlackError) return errorReply(err.message);
        return errorReply("Slack send failed: " + err.message);
      }
    }
  );

  server.tool(
    "slack_cancel",
    "Cancel a pending Slack draft. Call when the user rejects the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const row = resolvePending(pending_id, "cancelled");
      if (!row) return errorReply("No pending row with id " + pending_id);
      return jsonReply({ ok: true, cancelled: row.id });
    }
  );

  server.tool(
    "slack_list_channels",
    "List Slack channels visible to the bot, with member-status and topic.",
    {
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ limit }) => {
      try {
        const config = loadConfig();
        const channels = await listSlackChannels(config, { limit });
        return jsonReply({ count: channels.length, channels });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "slack_find_user",
    "Fuzzy-search workspace users by name, display name, or real name. Use this to resolve 'send to Alex' to an @user handle.",
    {
      query: z.string().min(1),
    },
    async ({ query }) => {
      try {
        const config = loadConfig();
        const users = await findSlackUser(config, query);
        return jsonReply({ query, count: users.length, users });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "slack_read_history",
    "Read the last N messages from a channel or DM. Use before drafting replies.",
    {
      channel: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ channel, limit }) => {
      try {
        const config = loadConfig();
        const result = await readSlackHistory(config, channel, { limit });
        return jsonReply(result);
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );
}
