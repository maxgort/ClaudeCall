#!/usr/bin/env node
// Pull recent interactions for a contact across all channels.
//
// Usage:
//   node query_history.mjs <contact> [limit]

import { queryHistory } from "./store.mjs";

const [, , contact, limitArg] = process.argv;
if (!contact) {
  console.error("Usage: query_history.mjs <contact> [limit]");
  process.exit(2);
}

const limit = limitArg ? Number(limitArg) : 10;
const rows = queryHistory(contact, limit);

console.log(
  JSON.stringify({ contact, count: rows.length, entries: rows }, null, 2)
);
