// Telegram MCP helpers — user-account (MTProto) via GramJS.
//
// Functions here take an injectable client for testability. Production callers
// use createTelegramClient(config) to get a real TelegramClient.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";

export function formatTelegramPreview(p) {
  return [
    "Chat: " + (p.resolved_chat_name || p.chat),
    p.reply_to_message_id
      ? "Reply to: msg " + p.reply_to_message_id
      : null,
    "",
    p.text,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export class TelegramError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "TelegramError";
    if (cause) this.cause = cause;
  }
}

export function createTelegramClient(config) {
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH) {
    throw new TelegramError(
      "TELEGRAM_API_ID / TELEGRAM_API_HASH missing. Get them at https://my.telegram.org."
    );
  }
  if (!config.TELEGRAM_SESSION) {
    throw new TelegramError(
      "TELEGRAM_SESSION missing. Run: node scripts/telegram_login.mjs"
    );
  }
  // Silence GramJS logger — MCP servers must not write anything to stdout
  // except newline-delimited JSON-RPC messages. Claude Desktop's MCP client
  // rejects any non-JSON line on stdout as a protocol error.
  const baseLogger = new Logger(LogLevel.NONE);
  const session = new StringSession(config.TELEGRAM_SESSION);
  return new TelegramClient(
    session,
    Number(config.TELEGRAM_API_ID),
    config.TELEGRAM_API_HASH,
    { connectionRetries: 2, baseLogger }
  );
}

// Ensure client is connected. GramJS lazily connects but we want to surface
// auth errors early.
async function ensureConnected(client) {
  if (!client.connected) {
    try {
      await client.connect();
    } catch (err) {
      throw new TelegramError("connect failed: " + err.message, { cause: err });
    }
  }
}

function extractEntityLabel(entity) {
  if (!entity) return "(unknown)";
  if (entity.title) return entity.title;
  if (entity.username) return "@" + entity.username;
  const parts = [entity.firstName, entity.lastName].filter(Boolean);
  return parts.join(" ") || "(unnamed)";
}

// Resolve a chat identifier to a GramJS entity. Accepts: @username, numeric
// id (as string), "+79..." phone number, or plain "First Last" name (scanned
// from recent dialogs).
export async function resolveChat(client, chat) {
  await ensureConnected(client);
  const q = String(chat).trim();
  // GramJS getEntity handles @username and numeric ids natively.
  if (/^@/.test(q) || /^-?\d+$/.test(q) || /^\+\d+/.test(q)) {
    try {
      return await client.getEntity(q);
    } catch (err) {
      throw new TelegramError(
        "could not resolve chat '" + q + "': " + err.message,
        { cause: err }
      );
    }
  }
  // Name match: scan dialogs and look for a case-insensitive substring.
  const needle = q.toLowerCase();
  const dialogs = await client.getDialogs({ limit: 100 });
  for (const d of dialogs) {
    const label = extractEntityLabel(d.entity).toLowerCase();
    if (label.includes(needle)) return d.entity;
  }
  throw new TelegramError(
    "no chat found matching '" + q + "' in your 100 most recent dialogs"
  );
}

export async function sendTelegramMessage(client, payload) {
  await ensureConnected(client);
  let entity;
  try {
    entity = await resolveChat(client, payload.chat);
  } catch (err) {
    throw err;
  }
  try {
    const result = await client.sendMessage(entity, {
      message: payload.text,
      replyTo: payload.reply_to_message_id,
    });
    return {
      message_id: result.id,
      chat_label: extractEntityLabel(entity),
    };
  } catch (err) {
    throw new TelegramError("sendMessage failed: " + err.message, {
      cause: err,
    });
  }
}

export async function listDialogs(client, limit = 20) {
  await ensureConnected(client);
  const dialogs = await client.getDialogs({ limit });
  return dialogs.map((d) => ({
    label: extractEntityLabel(d.entity),
    chat_id: d.entity?.id?.toString?.() || null,
    username: d.entity?.username || null,
    type: d.isUser ? "user" : d.isGroup ? "group" : d.isChannel ? "channel" : "unknown",
    unread: d.unreadCount || 0,
    last_message:
      (d.message?.message || "").slice(0, 100) || null,
    last_message_at: d.message?.date
      ? new Date(d.message.date * 1000).toISOString()
      : null,
  }));
}

export async function readHistory(client, chat, limit = 20) {
  await ensureConnected(client);
  const entity = await resolveChat(client, chat);
  const messages = await client.getMessages(entity, { limit });
  return messages.map((m) => ({
    id: m.id,
    from_me: !!m.out,
    sender_id: m.senderId?.toString?.() || null,
    text: m.message || "",
    date: m.date ? new Date(m.date * 1000).toISOString() : null,
  }));
}

export async function findContact(client, query, limit = 10) {
  await ensureConnected(client);
  const needle = String(query).toLowerCase();
  const dialogs = await client.getDialogs({ limit: 200 });
  const matches = [];
  for (const d of dialogs) {
    const label = extractEntityLabel(d.entity);
    if (label.toLowerCase().includes(needle)) {
      matches.push({
        label,
        chat_id: d.entity?.id?.toString?.() || null,
        username: d.entity?.username || null,
      });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
