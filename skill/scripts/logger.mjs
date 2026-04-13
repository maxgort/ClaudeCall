#!/usr/bin/env node
// Append a sent (or failed) action to ~/.claudecall/history.json.
//
// Usage:
//   node logger.mjs '<json entry>'
//
// Entry shape:
//   { channel, contact, direction, summary, content, status, error? }

import { appendHistory } from "./store.mjs";

const [, , raw] = process.argv;
if (!raw) {
  console.error("Usage: logger.mjs '<json-entry>'");
  process.exit(2);
}

let entry;
try {
  entry = JSON.parse(raw);
} catch (err) {
  console.error("Invalid JSON: " + err.message);
  process.exit(2);
}

const required = ["channel", "contact", "direction", "status"];
for (const k of required) {
  if (!entry[k]) {
    console.error("Missing required field: " + k);
    process.exit(2);
  }
}

const row = appendHistory(entry);
console.log(JSON.stringify({ ok: true, id: row.id }, null, 2));
