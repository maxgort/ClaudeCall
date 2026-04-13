import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeTmpRoot } from "../helpers/tmp_root.mjs";
import { spawnMcp } from "../helpers/mcp_client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const EMAIL_MCP = join(REPO, "mcps", "email", "index.mjs");
const VOICE_MCP = join(REPO, "mcps", "voice", "index.mjs");
const TELEGRAM_MCP = join(REPO, "mcps", "telegram", "index.mjs");
const CORE_MCP = join(REPO, "mcps", "core", "index.mjs");

let ctx;

beforeEach(() => {
  ctx = makeTmpRoot({
    profile: { user_name: "Alex", signature: "— Alex" },
  });
});

afterEach(() => {
  ctx.cleanup();
});

function env() {
  return { CLAUDECALL_ROOT: ctx.root };
}

test("tools/list exposes the expected tool names on all 4 servers", async () => {
  const core = await spawnMcp(CORE_MCP, env());
  const email = await spawnMcp(EMAIL_MCP, env());
  const voice = await spawnMcp(VOICE_MCP, env());
  const telegram = await spawnMcp(TELEGRAM_MCP, env());
  try {
    const byName = (list) => list.map((t) => t.name).sort();
    assert.deepEqual(byName(await core.listTools()), [
      "list_pending",
      "load_profile",
      "log_sent",
      "query_history",
    ]);
    assert.deepEqual(byName(await email.listTools()), [
      "email_cancel",
      "email_find_stale",
      "email_list_unread",
      "email_mark_read",
      "email_preview",
      "email_read",
      "email_search",
      "email_send",
    ]);
    assert.deepEqual(byName(await voice.listTools()), [
      "voice_cancel",
      "voice_create_call",
      "voice_get_call_result",
      "voice_list_scenarios",
      "voice_preview",
    ]);
    assert.deepEqual(byName(await telegram.listTools()), [
      "telegram_cancel",
      "telegram_find_contact",
      "telegram_list_dialogs",
      "telegram_preview",
      "telegram_read_history",
      "telegram_send",
    ]);
  } finally {
    await core.close();
    await email.close();
    await voice.close();
    await telegram.close();
  }
});

test("email_preview writes pending row with well-formed preview", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  try {
    const resp = await email.callToolJson("email_preview", {
      to: "alex@example.com",
      subject: "Test",
      body: "Hi there.\n\n— Alex",
    });
    assert.ok(resp?.pending_id, "pending_id present");
    assert.match(resp.preview, /To:\s+alex@example\.com/);
    assert.match(resp.preview, /Subject: Test/);
    assert.ok(
      resp.preview.includes("Subject: Test\n\nHi there."),
      "blank line between headers and body"
    );
  } finally {
    await email.close();
  }
});

test("email_preview rejects invalid email address via zod", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  try {
    const result = await email.callTool("email_preview", {
      to: "not-an-email",
      subject: "Test",
      body: "body",
    });
    assert.equal(result.isError, true);
  } finally {
    await email.close();
  }
});

test("preview → list_pending → cancel → list_pending round trip", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  const core = await spawnMcp(CORE_MCP, env());
  try {
    const preview = await email.callToolJson("email_preview", {
      to: "alex@example.com",
      subject: "s",
      body: "b",
    });
    const pendingId = preview.pending_id;

    const before = await core.callToolJson("list_pending", {});
    assert.ok(
      before.entries.some((e) => e.id === pendingId),
      "list_pending shows the new row"
    );

    const cancel = await email.callToolJson("email_cancel", {
      pending_id: pendingId,
    });
    assert.equal(cancel.ok, true);

    const after = await core.callToolJson("list_pending", {});
    assert.equal(
      after.entries.some((e) => e.id === pendingId),
      false,
      "cancelled row no longer open"
    );
  } finally {
    await email.close();
    await core.close();
  }
});

test("email_send rejects cancelled pending", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  try {
    const preview = await email.callToolJson("email_preview", {
      to: "alex@example.com",
      subject: "s",
      body: "b",
    });
    await email.callToolJson("email_cancel", { pending_id: preview.pending_id });
    const send = await email.callTool("email_send", {
      pending_id: preview.pending_id,
    });
    assert.equal(send.isError, true);
    assert.match(send.content[0].text, /cancelled/i);
  } finally {
    await email.close();
  }
});

test("email_send rejects unknown pending id", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  try {
    const send = await email.callTool("email_send", {
      pending_id: "nope-nope",
    });
    assert.equal(send.isError, true);
  } finally {
    await email.close();
  }
});

test("email_send rejects a pending row from another channel (voice)", async () => {
  const email = await spawnMcp(EMAIL_MCP, env());
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const voicePending = await voice.callToolJson("voice_preview", {
      to_number: "+15551234567",
      scenario: "restaurant_booking",
      variables: { restaurant_name: "Osteria" },
    });
    const send = await email.callTool("email_send", {
      pending_id: voicePending.pending_id,
    });
    assert.equal(send.isError, true);
    assert.match(send.content[0].text, /not an email/i);
  } finally {
    await email.close();
    await voice.close();
  }
});

test("voice_list_scenarios returns the 4 bundled scenarios", async () => {
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const resp = await voice.callToolJson("voice_list_scenarios", {});
    const names = resp.scenarios.map((s) => s.name).sort();
    assert.deepEqual(names, [
      "confirm_appointment",
      "followup_noreply",
      "reschedule_meeting",
      "restaurant_booking",
    ]);
  } finally {
    await voice.close();
  }
});

test("voice_preview rejects path-traversal scenario name", async () => {
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const resp = await voice.callTool("voice_preview", {
      to_number: "+15551234567",
      scenario: "../../README",
    });
    assert.equal(resp.isError, true);
  } finally {
    await voice.close();
  }
});

test("voice_preview with unknown (but valid-format) scenario name errors", async () => {
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const resp = await voice.callTool("voice_preview", {
      to_number: "+15551234567",
      scenario: "does_not_exist",
    });
    assert.equal(resp.isError, true);
  } finally {
    await voice.close();
  }
});

test("voice_preview with a real scenario writes pending and returns preview", async () => {
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const resp = await voice.callToolJson("voice_preview", {
      to_number: "+15551234567",
      scenario: "restaurant_booking",
      caller_name: "Alex",
      callback_number: "+15550100",
      variables: {
        restaurant_name: "Osteria",
        caller_name: "Alex",
        party_size: "2",
        date: "Friday",
        time: "7pm",
      },
    });
    assert.ok(resp.pending_id);
    assert.match(resp.preview, /Scenario:\s+restaurant_booking/);
    assert.match(resp.preview, /Call to:\s+\+15551234567/);
  } finally {
    await voice.close();
  }
});

test("voice_create_call without Vapi creds returns graceful error", async () => {
  const voice = await spawnMcp(VOICE_MCP, env());
  try {
    const preview = await voice.callToolJson("voice_preview", {
      to_number: "+15551234567",
      scenario: "restaurant_booking",
      variables: {},
    });
    const call = await voice.callTool("voice_create_call", {
      pending_id: preview.pending_id,
    });
    assert.equal(call.isError, true);
    assert.match(call.content[0].text, /VAPI/i);
  } finally {
    await voice.close();
  }
});

test("core.load_profile returns the tmp-root profile", async () => {
  const core = await spawnMcp(CORE_MCP, env());
  try {
    const profile = await core.callToolJson("load_profile", {});
    assert.equal(profile.user_name, "Alex");
  } finally {
    await core.close();
  }
});

test("core.load_profile errors when profile.json missing", async () => {
  const { root, cleanup } = makeTmpRoot(); // no profile
  try {
    const core = await spawnMcp(CORE_MCP, { CLAUDECALL_ROOT: root });
    try {
      const result = await core.callTool("load_profile", {});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /profile/i);
    } finally {
      await core.close();
    }
  } finally {
    cleanup();
  }
});

test("core.log_sent persists and query_history finds it", async () => {
  const core = await spawnMcp(CORE_MCP, env());
  try {
    const log = await core.callToolJson("log_sent", {
      channel: "email",
      contact: "alex@example.com",
      direction: "outbound",
      summary: "first message",
      content: "body",
      status: "sent",
    });
    assert.equal(log.ok, true);

    const q = await core.callToolJson("query_history", {
      contact: "alex@example.com",
    });
    assert.equal(q.count, 1);
    assert.equal(q.entries[0].summary, "first message");
  } finally {
    await core.close();
  }
});

test("telegram_preview returns a credentials error when session missing", async () => {
  // Without TELEGRAM_API_ID / HASH / SESSION in the tmp config.env, the
  // telegram MCP should fail loudly on first tool call rather than crashing.
  const telegram = await spawnMcp(TELEGRAM_MCP, env());
  try {
    const result = await telegram.callTool("telegram_preview", {
      chat: "@someone",
      text: "hi",
    });
    assert.equal(result.isError, true);
    assert.match(
      result.content[0].text,
      /TELEGRAM_API_ID|TELEGRAM_API_HASH|TELEGRAM_SESSION/
    );
  } finally {
    await telegram.close();
  }
});
