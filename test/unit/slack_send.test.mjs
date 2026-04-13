import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sendSlackMessage,
  listSlackChannels,
  findSlackUser,
  resolveSlackChannel,
  formatSlackPreview,
  SlackError,
  SLACK_BASE_URL,
} from "../../mcps/slack/helpers.mjs";

function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init });
  };
  fn.calls = calls;
  return fn;
}

function okResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const config = { SLACK_BOT_TOKEN: "xoxb-test-token" };

test("formatSlackPreview shows channel and text with blank line", () => {
  const out = formatSlackPreview({
    channel: "#general",
    resolved_channel_name: "#general",
    text: "hi team",
  });
  assert.match(out, /Channel: #general/);
  assert.ok(out.includes("\n\nhi team"));
});

test("formatSlackPreview shows thread_ts when set", () => {
  const out = formatSlackPreview({
    resolved_channel_name: "#general",
    thread_ts: "1700000000.123",
    text: "re",
  });
  assert.match(out, /Thread: 1700000000\.123/);
});

test("resolveSlackChannel passes raw channel ID through", async () => {
  // Raw IDs don't need API calls
  const res = await resolveSlackChannel(config, "C012ABC3456", {});
  assert.equal(res.id, "C012ABC3456");
  assert.equal(res.kind, "id");
});

test("resolveSlackChannel opens DM for @username", async () => {
  const fetchFn = mockFetch(({ url }) => {
    if (url.includes("users.list")) {
      return okResponse({
        ok: true,
        members: [{ id: "U123", name: "alex", profile: { display_name: "alex" } }],
      });
    }
    if (url.includes("conversations.open")) {
      return okResponse({ ok: true, channel: { id: "D456" } });
    }
    return okResponse({ ok: false });
  });
  const res = await resolveSlackChannel(config, "@alex", { fetchFn });
  assert.equal(res.id, "D456");
  assert.equal(res.kind, "dm");
  assert.equal(res.name, "@alex");
});

test("resolveSlackChannel looks up channel name via conversations.list", async () => {
  const fetchFn = mockFetch(({ url }) => {
    if (url.includes("conversations.list")) {
      return okResponse({
        ok: true,
        channels: [
          { id: "C1", name: "random" },
          { id: "C2", name: "general" },
        ],
      });
    }
    return okResponse({ ok: false });
  });
  const res = await resolveSlackChannel(config, "#general", { fetchFn });
  assert.equal(res.id, "C2");
  assert.equal(res.name, "#general");
});

test("resolveSlackChannel throws when channel not visible to bot", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({ ok: true, channels: [{ id: "C1", name: "random" }] })
  );
  await assert.rejects(
    () => resolveSlackChannel(config, "#missing", { fetchFn }),
    (err) => {
      assert.ok(err instanceof SlackError);
      return true;
    }
  );
});

test("sendSlackMessage posts to chat.postMessage with resolved channel", async () => {
  const fetchFn = mockFetch(({ url }) => {
    if (url.includes("conversations.list")) {
      return okResponse({
        ok: true,
        channels: [{ id: "C2", name: "general" }],
      });
    }
    if (url.includes("chat.postMessage")) {
      return okResponse({ ok: true, ts: "1700000000.999" });
    }
    return okResponse({ ok: false });
  });
  const result = await sendSlackMessage(
    config,
    { channel: "#general", text: "hi team" },
    { fetchFn }
  );
  assert.equal(result.channel_id, "C2");
  assert.equal(result.channel_label, "#general");
  assert.equal(result.message_ts, "1700000000.999");

  const postCall = fetchFn.calls.find((c) => c.url.includes("chat.postMessage"));
  assert.ok(postCall);
  const body = JSON.parse(postCall.init.body);
  assert.equal(body.channel, "C2");
  assert.equal(body.text, "hi team");
  assert.equal(
    postCall.init.headers.Authorization,
    "Bearer xoxb-test-token"
  );
});

test("sendSlackMessage wraps Slack 'not_in_channel' error", async () => {
  const fetchFn = mockFetch(({ url }) => {
    if (url.includes("conversations.list")) {
      return okResponse({
        ok: true,
        channels: [{ id: "C2", name: "general" }],
      });
    }
    return okResponse({ ok: false, error: "not_in_channel" });
  });
  await assert.rejects(
    () =>
      sendSlackMessage(
        config,
        { channel: "#general", text: "hi" },
        { fetchFn }
      ),
    (err) => {
      assert.ok(err instanceof SlackError);
      assert.match(err.message, /not_in_channel/);
      return true;
    }
  );
});

test("listSlackChannels returns simplified shape", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({
      ok: true,
      channels: [
        {
          id: "C1",
          name: "general",
          is_private: false,
          is_member: true,
          num_members: 42,
          topic: { value: "chat" },
        },
        {
          id: "C2",
          name: "secret",
          is_private: true,
          is_member: false,
        },
      ],
    })
  );
  const channels = await listSlackChannels(config, {}, { fetchFn });
  assert.equal(channels.length, 2);
  assert.equal(channels[0].name, "#general");
  assert.equal(channels[0].is_member, true);
  assert.equal(channels[0].num_members, 42);
  assert.equal(channels[1].is_private, true);
});

test("findSlackUser filters by name substring, skips bots and deleted", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({
      ok: true,
      members: [
        { id: "U1", name: "alex", profile: { display_name: "Alex R" } },
        { id: "U2", name: "bot", is_bot: true },
        { id: "U3", name: "alexander", profile: { display_name: "Alexander" } },
        { id: "U4", name: "bob", profile: { display_name: "Bob" } },
        { id: "U5", name: "old", deleted: true },
      ],
    })
  );
  const matches = await findSlackUser(config, "alex", { fetchFn });
  const ids = matches.map((m) => m.id).sort();
  assert.deepEqual(ids, ["U1", "U3"]);
});

test("Slack helpers throw when token missing", async () => {
  await assert.rejects(
    () => listSlackChannels({}, {}, {}),
    (err) => {
      assert.ok(err instanceof SlackError);
      assert.match(err.message, /SLACK_BOT_TOKEN/);
      return true;
    }
  );
});
