#!/usr/bin/env node
// End-to-end Telegram test using the real user-account MCP (GramJS/MTProto).
// Requires TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION in
// ~/.claudecall/config.env — run scripts/telegram_login.mjs first.
//
// Usage:
//   node scripts/e2e_telegram_user.mjs <chat> [text]
//
// <chat> can be @username, numeric id, or a name from your recent dialogs.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnMcp } from "../test/helpers/mcp_client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TELEGRAM_MCP = resolve(__dirname, "..", "mcps", "telegram", "index.mjs");

const chat = process.argv[2];
if (!chat) {
  console.error("Usage: node scripts/e2e_telegram_user.mjs <chat> [text]");
  process.exit(2);
}

const text =
  process.argv[3] ||
  [
    "👋 Hi from ClaudeCall (user-account MTProto)",
    "",
    "If you see this message, the full user-account pipeline works:",
    "preview → approval → GramJS sendMessage → delivered.",
    "",
    "Sent at: " + new Date().toString(),
  ].join("\n");

console.log("=== ClaudeCall e2e telegram (user account) ===");
console.log("chat: " + chat);
console.log();

const client = await spawnMcp(TELEGRAM_MCP);
try {
  console.log("1. telegram_preview ...");
  const preview = await client.callToolJson("telegram_preview", {
    chat,
    text,
  });
  if (!preview?.pending_id) {
    console.error("FAIL: preview did not return a pending_id");
    console.error(JSON.stringify(preview, null, 2));
    process.exit(1);
  }
  console.log("   pending_id: " + preview.pending_id);
  console.log("   preview:");
  console.log(
    preview.preview
      .split("\n")
      .map((l) => "     " + l)
      .join("\n")
  );
  console.log();

  console.log("2. telegram_send ...");
  const sendResult = await client.callTool("telegram_send", {
    pending_id: preview.pending_id,
  });
  if (sendResult.isError) {
    console.error("FAIL: " + sendResult.content[0].text);
    process.exit(1);
  }
  const send = JSON.parse(sendResult.content[0].text);
  console.log("   ok:         " + send.ok);
  console.log("   message_id: " + send.message_id);
  console.log("   chat_label: " + send.chat_label);
  console.log();
  console.log("PASS — check the chat in Telegram.");
} finally {
  await client.close();
}
