#!/usr/bin/env node
// End-to-end email test: spawns the real email MCP, drives the preview→send
// flow with real SMTP credentials from ~/.claudecall/config.env, and prints
// the result.
//
// Usage:
//   node scripts/e2e_email.mjs <to_address> [subject] [body]

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnMcp } from "../test/helpers/mcp_client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMAIL_MCP = resolve(__dirname, "..", "mcps", "email", "index.mjs");

const to = process.argv[2];
if (!to) {
  console.error("Usage: node scripts/e2e_email.mjs <to_address> [subject] [body]");
  process.exit(2);
}

const subject = process.argv[3] || "ClaudeCall e2e test — " + new Date().toISOString();
const body =
  process.argv[4] ||
  [
    "Hi,",
    "",
    "This message was sent by the ClaudeCall email MCP as part of an",
    "end-to-end test. If you're reading it, the full pipeline works:",
    "",
    "  preview → pending row → approval → SMTP send → delivered.",
    "",
    "Sent at: " + new Date().toString(),
    "",
    "— ClaudeCall",
  ].join("\n");

console.log("=== ClaudeCall e2e email test ===");
console.log("To:      " + to);
console.log("Subject: " + subject);
console.log();

const client = await spawnMcp(EMAIL_MCP);
try {
  // Step 1: preview (writes pending row).
  console.log("1. email_preview ...");
  const preview = await client.callToolJson("email_preview", {
    to,
    subject,
    body,
  });
  if (!preview?.pending_id) {
    console.error("FAIL: email_preview did not return a pending_id");
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

  // Step 2: send (hits real SMTP).
  console.log("2. email_send ...");
  const sendResult = await client.callTool("email_send", {
    pending_id: preview.pending_id,
  });

  if (sendResult.isError) {
    console.error("FAIL: " + sendResult.content[0].text);
    process.exit(1);
  }

  const send = JSON.parse(sendResult.content[0].text);
  console.log("   ok:          " + send.ok);
  console.log("   message_id:  " + send.message_id);
  console.log(
    "   accepted:    " +
      (Array.isArray(send.accepted) ? send.accepted.join(", ") : send.accepted)
  );
  if (send.rejected && send.rejected.length) {
    console.log("   rejected:    " + send.rejected.join(", "));
  }
  console.log();
  console.log("PASS — message accepted by SMTP server.");
  console.log("Check " + to + " inbox in a moment.");
} finally {
  await client.close();
}
