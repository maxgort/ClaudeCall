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
  formatTelegramPreview,
  createTelegramClient,
  sendTelegramMessage,
  listDialogs,
  readHistory,
  findContact,
  resolveChat,
} from "./helpers.mjs";

// Cached client — MTProto connections are expensive to re-establish.
let cachedClient = null;
async function getClient() {
  if (cachedClient) return cachedClient;
  const config = loadConfig();
  cachedClient = createTelegramClient(config);
  return cachedClient;
}

export function registerTelegramTools(server) {
  server.tool(
    "telegram_preview",
    "Create a pending Telegram message draft. Resolves the chat so the user sees a human label in the preview, then waits for approval before calling telegram_send.",
    {
      chat: z
        .string()
        .describe(
          "@username, numeric chat id, phone (+79...), or a person's name from your recent dialogs."
        ),
      text: z.string().min(1),
      reply_to_message_id: z.number().int().optional(),
    },
    async (payload) => {
      try {
        const client = await getClient();
        const entity = await resolveChat(client, payload.chat);
        const label =
          entity.title ||
          (entity.username ? "@" + entity.username : null) ||
          [entity.firstName, entity.lastName].filter(Boolean).join(" ") ||
          payload.chat;

        const row = appendPending({
          channel: "telegram",
          action: "send",
          payload: { ...payload, resolved_chat_name: label },
        });

        return jsonReply({
          pending_id: row.id,
          preview: formatTelegramPreview({
            ...payload,
            resolved_chat_name: label,
          }),
          instructions:
            "Show this preview to the user. Wait for explicit 'ok'/'send'/'approve' before calling telegram_send. On rejection call telegram_cancel.",
        });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "telegram_send",
    "Actually send a previously-previewed Telegram message through the user's own account. Only call after explicit user approval.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply(
          "Pending row is already " + pending.status + " and cannot be sent."
        );
      }
      if (pending.channel !== "telegram") {
        return errorReply("Pending row is not a telegram action.");
      }

      const p = pending.payload;
      try {
        const client = await getClient();
        const { message_id, chat_label } = await sendTelegramMessage(client, p);

        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "telegram",
          contact: chat_label,
          direction: "outbound",
          summary: p.text.slice(0, 80),
          content: p.text,
          status: "sent",
          provider_message_id: message_id,
        });

        return jsonReply({ ok: true, message_id, chat_label });
      } catch (err) {
        appendHistory({
          channel: "telegram",
          contact: p.resolved_chat_name || String(p.chat),
          direction: "outbound",
          summary: p.text.slice(0, 80),
          content: p.text,
          status: "failed",
          error: err.message,
        });
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "telegram_cancel",
    "Cancel a pending Telegram draft. Call when the user rejects the preview.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const row = resolvePending(pending_id, "cancelled");
      if (!row) return errorReply("No pending row with id " + pending_id);
      return jsonReply({ ok: true, cancelled: row.id });
    }
  );

  server.tool(
    "telegram_list_dialogs",
    "List the user's most recent Telegram chats (private, groups, channels). Use this to find the right chat when the user refers to a person by name.",
    {
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ limit }) => {
      try {
        const client = await getClient();
        const dialogs = await listDialogs(client, limit);
        return jsonReply({ count: dialogs.length, dialogs });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "telegram_read_history",
    "Read the last N messages from a specific chat. Use this before drafting a reply so you understand the context of the conversation.",
    {
      chat: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(20),
    },
    async ({ chat, limit }) => {
      try {
        const client = await getClient();
        const messages = await readHistory(client, chat, limit);
        return jsonReply({ chat, count: messages.length, messages });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "telegram_find_contact",
    "Fuzzy-search the user's recent dialogs for a contact by name or username.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(30).optional().default(10),
    },
    async ({ query, limit }) => {
      try {
        const client = await getClient();
        const matches = await findContact(client, query, limit);
        return jsonReply({ query, count: matches.length, matches });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );
}

// Graceful disconnect on process exit — called from the entry point.
export function disconnectTelegramClient() {
  if (cachedClient && cachedClient.connected) {
    cachedClient.disconnect().catch(() => {});
  }
}
