// Single-writer-safe JSON store for ClaudeCall state.
// NOT safe for concurrent writers — personal-use assumption. All writes are
// read-modify-write on the same file.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getHistory, getPending, getProfile } from "./paths.mjs";

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export function loadProfile() {
  const path = getProfile();
  if (!existsSync(path)) return null;
  return readJson(path, null);
}

export function loadHistory() {
  return readJson(getHistory(), { entries: [] });
}

export function loadPending() {
  return readJson(getPending(), { entries: [] });
}

export function appendHistory(entry) {
  const db = loadHistory();
  db.entries.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  writeJson(getHistory(), db);
  return db.entries[db.entries.length - 1];
}

export function appendPending(entry) {
  const db = loadPending();
  const row = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    status: "pending",
    ...entry,
  };
  db.entries.push(row);
  writeJson(getPending(), db);
  return row;
}

export function resolvePending(id, newStatus) {
  const db = loadPending();
  const row = db.entries.find((e) => e.id === id);
  if (!row) return null;
  row.status = newStatus;
  row.resolved_at = new Date().toISOString();
  writeJson(getPending(), db);
  return row;
}

export function queryHistory(contact, limit = 10) {
  const db = loadHistory();
  const needle = (contact || "").toLowerCase().trim();
  if (!needle) return [];
  const matches = db.entries.filter((e) => {
    const c = (e.contact || "").toLowerCase();
    return c.includes(needle) || needle.includes(c);
  });
  return matches.slice(-limit).reverse();
}
