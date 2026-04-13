// Slack MCP helpers — uses the Slack Web API with a Bot User OAuth Token.
// Bot must be installed in the workspace and invited to any private channels
// it needs to post to. Works for public channels immediately.

export const SLACK_BASE_URL = "https://slack.com/api";

export class SlackError extends Error {
  constructor(message, { cause, data } = {}) {
    super(message);
    this.name = "SlackError";
    if (cause) this.cause = cause;
    if (data) this.data = data;
  }
}

export function formatSlackPreview(p) {
  return [
    "Channel: " + (p.resolved_channel_name || p.channel),
    p.thread_ts ? "Thread: " + p.thread_ts : null,
    "",
    p.text,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

async function slackApi(
  config,
  method,
  body = null,
  { fetchFn = fetch, baseUrl = SLACK_BASE_URL } = {}
) {
  if (!config.SLACK_BOT_TOKEN) {
    throw new SlackError(
      "SLACK_BOT_TOKEN missing. Create a Slack app at https://api.slack.com/apps and install it to your workspace with chat:write scope."
    );
  }

  const url = baseUrl + "/" + method;
  let resp;
  try {
    if (body) {
      resp = await fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.SLACK_BOT_TOKEN,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });
    } else {
      resp = await fetchFn(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + config.SLACK_BOT_TOKEN },
      });
    }
  } catch (err) {
    throw new SlackError("network error: " + err.message, { cause: err });
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok || !data.ok) {
    throw new SlackError(
      "Slack " + method + " failed: " + (data?.error || resp.statusText),
      { data }
    );
  }

  return data;
}

// Resolves a channel identifier to a Slack channel ID. Accepts: #channel-name,
// channel-name, C012ABC (raw ID), or @username (DM).
export async function resolveSlackChannel(
  config,
  channel,
  opts = {}
) {
  const q = String(channel).trim();

  // Raw channel ID — use as-is.
  if (/^[CGD][A-Z0-9]{8,}$/.test(q)) {
    return { id: q, name: q, kind: "id" };
  }

  // DM to user: look up user by @username.
  if (q.startsWith("@")) {
    const username = q.slice(1);
    const usersList = await slackApi(
      config,
      "users.list",
      null,
      opts
    );
    const user = usersList.members?.find(
      (u) =>
        u.name === username ||
        u.profile?.display_name === username ||
        u.profile?.real_name === username
    );
    if (!user) {
      throw new SlackError("no user @" + username + " in workspace");
    }
    // Open (or reuse) a DM channel.
    const im = await slackApi(
      config,
      "conversations.open",
      { users: user.id },
      opts
    );
    return {
      id: im.channel?.id,
      name: "@" + (user.profile?.display_name || user.name),
      kind: "dm",
    };
  }

  // Channel name (#name or name): list and find by name.
  const bare = q.startsWith("#") ? q.slice(1) : q;
  const list = await slackApi(
    config,
    "conversations.list?types=public_channel,private_channel&limit=1000",
    null,
    opts
  );
  const match = list.channels?.find((c) => c.name === bare);
  if (!match) {
    throw new SlackError(
      "no channel #" + bare + " visible to bot; make sure the bot is invited"
    );
  }
  return { id: match.id, name: "#" + match.name, kind: "channel" };
}

export async function sendSlackMessage(config, payload, opts = {}) {
  const channel = await resolveSlackChannel(config, payload.channel, opts);
  const data = await slackApi(
    config,
    "chat.postMessage",
    {
      channel: channel.id,
      text: payload.text,
      thread_ts: payload.thread_ts,
    },
    opts
  );
  return {
    channel_id: channel.id,
    channel_label: channel.name,
    message_ts: data.ts,
  };
}

export async function listSlackChannels(
  config,
  { limit = 50 } = {},
  opts = {}
) {
  const data = await slackApi(
    config,
    "conversations.list?types=public_channel,private_channel&limit=" +
      encodeURIComponent(limit),
    null,
    opts
  );
  return (data.channels || []).map((c) => ({
    id: c.id,
    name: "#" + c.name,
    is_private: !!c.is_private,
    is_member: !!c.is_member,
    num_members: c.num_members || null,
    topic: c.topic?.value || null,
  }));
}

export async function findSlackUser(config, query, opts = {}) {
  const needle = String(query).toLowerCase();
  const data = await slackApi(config, "users.list", null, opts);
  return (data.members || [])
    .filter((u) => !u.deleted && !u.is_bot)
    .filter((u) => {
      const name = (u.name || "").toLowerCase();
      const display = (u.profile?.display_name || "").toLowerCase();
      const real = (u.profile?.real_name || "").toLowerCase();
      return (
        name.includes(needle) ||
        display.includes(needle) ||
        real.includes(needle)
      );
    })
    .slice(0, 20)
    .map((u) => ({
      id: u.id,
      handle: "@" + (u.profile?.display_name || u.name),
      real_name: u.profile?.real_name || null,
      email: u.profile?.email || null,
    }));
}

export async function readSlackHistory(
  config,
  channelIdent,
  { limit = 20 } = {},
  opts = {}
) {
  const channel = await resolveSlackChannel(config, channelIdent, opts);
  const data = await slackApi(
    config,
    "conversations.history?channel=" +
      encodeURIComponent(channel.id) +
      "&limit=" +
      encodeURIComponent(limit),
    null,
    opts
  );
  return {
    channel: channel.name,
    channel_id: channel.id,
    messages: (data.messages || []).map((m) => ({
      ts: m.ts,
      user: m.user || null,
      text: m.text || "",
      thread_ts: m.thread_ts || null,
    })),
  };
}
