import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sendTelegramMessage,
  listDialogs,
  readHistory,
  findContact,
  resolveChat,
  formatTelegramPreview,
  TelegramError,
  createTelegramClient,
} from "../../mcps/telegram/helpers.mjs";

// Minimal mock TelegramClient that records what it was asked to do.
function mockClient({ entities = {}, dialogs = [], messages = [] } = {}) {
  const calls = [];
  const client = {
    connected: true,
    async connect() {
      calls.push({ m: "connect" });
    },
    async disconnect() {
      calls.push({ m: "disconnect" });
    },
    async getEntity(q) {
      calls.push({ m: "getEntity", q });
      if (entities[q]) return entities[q];
      const err = new Error("no entity for " + q);
      throw err;
    },
    async getDialogs({ limit }) {
      calls.push({ m: "getDialogs", limit });
      return dialogs;
    },
    async getMessages(entity, { limit }) {
      calls.push({ m: "getMessages", entity, limit });
      return messages;
    },
    async sendMessage(entity, opts) {
      calls.push({ m: "sendMessage", entity, opts });
      return { id: 4242 };
    },
  };
  client.calls = calls;
  return client;
}

test("formatTelegramPreview shows resolved chat name, not raw input", () => {
  const out = formatTelegramPreview({
    chat: "ivan",
    resolved_chat_name: "Ivan Petrov",
    text: "hi",
  });
  assert.match(out, /Chat: Ivan Petrov/);
  assert.equal(out.includes("\n\nhi"), true);
});

test("formatTelegramPreview shows reply_to_message_id when set", () => {
  const out = formatTelegramPreview({
    resolved_chat_name: "Ivan",
    reply_to_message_id: 77,
    text: "re: yours",
  });
  assert.match(out, /Reply to: msg 77/);
});

test("resolveChat handles @username", async () => {
  const client = mockClient({
    entities: { "@alex_m": { username: "alex_m", firstName: "Alex" } },
  });
  const e = await resolveChat(client, "@alex_m");
  assert.equal(e.username, "alex_m");
  assert.ok(client.calls.some((c) => c.m === "getEntity"));
});

test("resolveChat handles numeric id", async () => {
  const client = mockClient({
    entities: { "123456": { id: 123456, firstName: "Test" } },
  });
  const e = await resolveChat(client, "123456");
  assert.equal(e.id, 123456);
});

test("resolveChat falls back to dialog scan for plain names", async () => {
  const client = mockClient({
    dialogs: [
      { entity: { firstName: "Alex", lastName: "Rivers" } },
      { entity: { firstName: "Ivan", lastName: "Petrov" } },
    ],
  });
  const e = await resolveChat(client, "ivan");
  assert.equal(e.firstName, "Ivan");
  // Should have asked for dialogs, not tried getEntity on a raw name
  assert.ok(client.calls.some((c) => c.m === "getDialogs"));
  assert.ok(!client.calls.some((c) => c.m === "getEntity"));
});

test("resolveChat throws TelegramError when dialog scan finds nothing", async () => {
  const client = mockClient({ dialogs: [] });
  await assert.rejects(() => resolveChat(client, "ghost"), TelegramError);
});

test("sendTelegramMessage calls sendMessage with resolved entity", async () => {
  const entity = { username: "alex_m", firstName: "Alex" };
  const client = mockClient({ entities: { "@alex_m": entity } });
  const result = await sendTelegramMessage(client, {
    chat: "@alex_m",
    text: "hello",
  });
  assert.equal(result.message_id, 4242);
  assert.equal(result.chat_label, "@alex_m");
  const sendCall = client.calls.find((c) => c.m === "sendMessage");
  assert.ok(sendCall);
  assert.equal(sendCall.entity, entity);
  assert.equal(sendCall.opts.message, "hello");
});

test("sendTelegramMessage passes reply_to_message_id as replyTo", async () => {
  const client = mockClient({
    entities: { "@alex": { username: "alex" } },
  });
  await sendTelegramMessage(client, {
    chat: "@alex",
    text: "re",
    reply_to_message_id: 77,
  });
  const sendCall = client.calls.find((c) => c.m === "sendMessage");
  assert.equal(sendCall.opts.replyTo, 77);
});

test("sendTelegramMessage wraps provider errors in TelegramError", async () => {
  const client = {
    connected: true,
    async getEntity() {
      return { username: "alex" };
    },
    async sendMessage() {
      throw new Error("FLOOD_WAIT_5");
    },
  };
  await assert.rejects(
    () => sendTelegramMessage(client, { chat: "@alex", text: "hi" }),
    (err) => {
      assert.ok(err instanceof TelegramError);
      assert.match(err.message, /FLOOD_WAIT_5/);
      return true;
    }
  );
});

test("sendTelegramMessage triggers connect() when not connected", async () => {
  const client = mockClient({
    entities: { "@alex": { username: "alex" } },
  });
  client.connected = false;
  await sendTelegramMessage(client, { chat: "@alex", text: "hi" });
  assert.ok(client.calls.some((c) => c.m === "connect"));
});

test("listDialogs returns mapped shape with labels and types", async () => {
  const client = mockClient({
    dialogs: [
      {
        entity: { firstName: "Alex", lastName: "R", id: { toString: () => "111" } },
        isUser: true,
        unreadCount: 2,
        message: { message: "hello", date: 1700000000 },
      },
      {
        entity: { title: "Team", id: { toString: () => "-222" } },
        isGroup: true,
        unreadCount: 0,
        message: { message: "meeting at 3", date: 1700000100 },
      },
    ],
  });
  const out = await listDialogs(client, 20);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, "Alex R");
  assert.equal(out[0].type, "user");
  assert.equal(out[0].unread, 2);
  assert.equal(out[0].chat_id, "111");
  assert.equal(out[1].label, "Team");
  assert.equal(out[1].type, "group");
});

test("readHistory returns messages with from_me and text", async () => {
  const client = mockClient({
    entities: { "@alex": { username: "alex" } },
    messages: [
      { id: 1, out: true, message: "hi", date: 1700000000, senderId: { toString: () => "me" } },
      { id: 2, out: false, message: "hey", date: 1700000001, senderId: { toString: () => "alex" } },
    ],
  });
  const msgs = await readHistory(client, "@alex", 10);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].from_me, true);
  assert.equal(msgs[0].text, "hi");
  assert.equal(msgs[1].from_me, false);
});

test("findContact substring-matches across dialog labels", async () => {
  const client = mockClient({
    dialogs: [
      { entity: { firstName: "Alex", lastName: "Rivers", id: { toString: () => "1" } } },
      { entity: { firstName: "Alexander", id: { toString: () => "2" } } },
      { entity: { firstName: "Bob", id: { toString: () => "3" } } },
    ],
  });
  const matches = await findContact(client, "alex", 10);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((m) => m.label).sort(),
    ["Alex Rivers", "Alexander"]
  );
});

test("findContact respects limit", async () => {
  const client = mockClient({
    dialogs: Array.from({ length: 10 }, (_, i) => ({
      entity: { firstName: "Alex" + i, id: { toString: () => String(i) } },
    })),
  });
  const matches = await findContact(client, "alex", 3);
  assert.equal(matches.length, 3);
});

test("createTelegramClient throws when credentials missing", () => {
  assert.throws(
    () => createTelegramClient({}),
    (err) => {
      assert.ok(err instanceof TelegramError);
      assert.match(err.message, /API_ID|API_HASH/);
      return true;
    }
  );
  assert.throws(
    () =>
      createTelegramClient({
        TELEGRAM_API_ID: "123",
        TELEGRAM_API_HASH: "abc",
      }),
    (err) => {
      assert.ok(err instanceof TelegramError);
      assert.match(err.message, /TELEGRAM_SESSION/);
      return true;
    }
  );
});
