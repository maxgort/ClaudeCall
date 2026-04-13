import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withTmpRoot } from "../helpers/tmp_root.mjs";
import {
  appendPending,
  appendHistory,
  resolvePending,
  queryHistory,
  loadPending,
  loadHistory,
  loadProfile,
} from "../../skill/scripts/store.mjs";

test("appendPending assigns id, timestamp, pending status", () =>
  withTmpRoot(async () => {
    const row = appendPending({ channel: "email", action: "send", payload: { to: "a@b.com" } });
    assert.ok(row.id, "has id");
    assert.ok(row.timestamp, "has timestamp");
    assert.equal(row.status, "pending");
    assert.equal(row.channel, "email");

    const db = loadPending();
    assert.equal(db.entries.length, 1);
    assert.equal(db.entries[0].id, row.id);
  }));

test("appendHistory assigns id and timestamp", () =>
  withTmpRoot(async () => {
    const row = appendHistory({
      channel: "email",
      contact: "a@b.com",
      direction: "outbound",
      status: "sent",
      summary: "hi",
    });
    assert.ok(row.id);
    assert.ok(row.timestamp);
    assert.equal(loadHistory().entries.length, 1);
  }));

test("resolvePending on unknown id returns null", () =>
  withTmpRoot(async () => {
    const result = resolvePending("does-not-exist", "approved");
    assert.equal(result, null);
  }));

test("resolvePending flips status and records resolved_at", () =>
  withTmpRoot(async () => {
    const row = appendPending({ channel: "email", action: "send", payload: {} });
    const resolved = resolvePending(row.id, "cancelled");
    assert.equal(resolved.status, "cancelled");
    assert.ok(resolved.resolved_at);

    const db = loadPending();
    assert.equal(db.entries[0].status, "cancelled");
  }));

test("queryHistory substring match (both directions) + case insensitive", () =>
  withTmpRoot(async () => {
    appendHistory({
      channel: "email",
      contact: "alex@example.com",
      direction: "outbound",
      status: "sent",
      summary: "a",
    });
    appendHistory({
      channel: "telegram",
      contact: "@alex_m",
      direction: "outbound",
      status: "sent",
      summary: "b",
    });
    appendHistory({
      channel: "voice",
      contact: "+15550199",
      direction: "outbound",
      status: "sent",
      summary: "c",
    });

    // Substring: "alex" matches both email and telegram
    const byAlex = queryHistory("alex");
    assert.equal(byAlex.length, 2);

    // Case insensitive
    assert.equal(queryHistory("ALEX").length, 2);

    // Reverse substring: full email contains the search token in its contact field
    assert.equal(queryHistory("alex@example.com").length, 1);

    // Full phone match
    assert.equal(queryHistory("+15550199").length, 1);

    // Empty needle returns empty
    assert.deepEqual(queryHistory(""), []);
    assert.deepEqual(queryHistory("   "), []);
  }));

test("queryHistory respects limit and returns newest first", () =>
  withTmpRoot(async () => {
    for (let i = 0; i < 5; i++) {
      appendHistory({
        channel: "email",
        contact: "alex@example.com",
        direction: "outbound",
        status: "sent",
        summary: "msg " + i,
      });
    }
    const rows = queryHistory("alex", 3);
    assert.equal(rows.length, 3);
    // Newest first = summary "msg 4" before "msg 2"
    assert.equal(rows[0].summary, "msg 4");
    assert.equal(rows[2].summary, "msg 2");
  }));

test("loadPending falls back to empty on corrupt JSON", () =>
  withTmpRoot(async (root) => {
    writeFileSync(join(root, "pending.json"), "{ not valid json");
    const db = loadPending();
    assert.deepEqual(db, { entries: [] });
  }));

test("loadHistory falls back to empty on missing file", () =>
  withTmpRoot(async (root) => {
    // Delete history.json so loadHistory sees a missing file
    writeFileSync(join(root, "history.json"), "{ nope");
    const db = loadHistory();
    assert.deepEqual(db, { entries: [] });
  }));

test("loadProfile returns null when profile.json missing", () =>
  withTmpRoot(async () => {
    // No profile written in the tmp root
    assert.equal(loadProfile(), null);
  }));

test("loadProfile returns parsed JSON when present", () =>
  withTmpRoot({ profile: { user_name: "Alex" } }, async () => {
    const profile = loadProfile();
    assert.deepEqual(profile, { user_name: "Alex" });
  }));
