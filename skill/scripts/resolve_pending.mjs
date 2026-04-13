#!/usr/bin/env node
// Resolve a pending approval row.
//
// Usage:
//   node resolve_pending.mjs <id> <approved|cancelled>

import { resolvePending } from "./store.mjs";

const [, , id, status] = process.argv;

if (!id || !["approved", "cancelled"].includes(status)) {
  console.error("Usage: resolve_pending.mjs <id> <approved|cancelled>");
  process.exit(2);
}

const row = resolvePending(id, status);
if (!row) {
  console.error("No pending row with id " + id);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, row }, null, 2));
