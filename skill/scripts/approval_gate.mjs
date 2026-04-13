#!/usr/bin/env node
// Approval gate — Claude invokes this before any side-effectful send.
// Writes a `pending` row and prints a human-readable preview.
//
// Usage:
//   node approval_gate.mjs <channel> <action> '<json payload>'
//
// Example:
//   node approval_gate.mjs email send '{"to":"a@b.com","subject":"hi","body":"..."}'

import { appendPending } from "./store.mjs";

const [, , channel, action, rawPayload] = process.argv;

if (!channel || !action || !rawPayload) {
  console.error(
    "Usage: approval_gate.mjs <channel> <action> <json-payload>"
  );
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(rawPayload);
} catch (err) {
  console.error("Invalid JSON payload: " + err.message);
  process.exit(2);
}

const row = appendPending({ channel, action, payload });

function previewEmail(p) {
  return [
    "To:      " + (p.to ?? "(missing)"),
    "Cc:      " + (p.cc ?? "-"),
    "Subject: " + (p.subject ?? "(missing)"),
    "",
    p.body ?? "(empty body)",
  ].join("\n");
}

function previewVoice(p) {
  return [
    "Call to:    " + (p.to_number ?? "(missing)"),
    "Scenario:   " + (p.scenario ?? "ad-hoc"),
    "Caller as:  " + (p.caller_name ?? "(default)"),
    "",
    "Variables:",
    JSON.stringify(p.variables ?? {}, null, 2),
  ].join("\n");
}

function previewTelegram(p) {
  return [
    "To:  " + (p.chat ?? "(missing)"),
    "",
    p.text ?? "(empty message)",
  ].join("\n");
}

let preview;
switch (channel) {
  case "email":
    preview = previewEmail(payload);
    break;
  case "voice":
    preview = previewVoice(payload);
    break;
  case "telegram":
    preview = previewTelegram(payload);
    break;
  default:
    preview = JSON.stringify(payload, null, 2);
}

console.log(
  JSON.stringify(
    {
      pending_id: row.id,
      channel,
      action,
      preview,
      instructions:
        "Show this preview to the user in a code block and wait for explicit approval before calling the real send tool. Use 'resolve_pending.mjs <id> approved|cancelled' to close the row.",
    },
    null,
    2
  )
);
