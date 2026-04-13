import { test } from "node:test";
import assert from "node:assert/strict";

import { formatEmailPreview } from "../../mcps/email/helpers.mjs";
import { formatTelegramPreview } from "../../mcps/telegram/helpers.mjs";

test("email preview includes To/Subject/body with blank line between headers and body", () => {
  const out = formatEmailPreview({
    to: "alex@example.com",
    subject: "Hi there",
    body: "First line.\n\nSecond paragraph.",
  });
  assert.match(out, /^To:\s+alex@example\.com$/m);
  assert.match(out, /^Subject: Hi there$/m);
  // Blank line between subject and body is preserved
  assert.ok(out.includes("Subject: Hi there\n\nFirst line."));
});

test("email preview omits Cc/Bcc when not set", () => {
  const out = formatEmailPreview({
    to: "a@b.com",
    subject: "s",
    body: "b",
  });
  assert.equal(out.includes("Cc:"), false);
  assert.equal(out.includes("Bcc:"), false);
});

test("email preview shows Cc and Bcc when set", () => {
  const out = formatEmailPreview({
    to: "a@b.com",
    cc: "c@b.com",
    bcc: "d@b.com",
    subject: "s",
    body: "b",
  });
  assert.match(out, /^Cc:\s+c@b\.com$/m);
  assert.match(out, /^Bcc:\s+d@b\.com$/m);
});

test("email preview preserves UTF-8 and emojis in body", () => {
  const out = formatEmailPreview({
    to: "a@b.com",
    subject: "привет",
    body: "ça va? 🚀",
  });
  assert.ok(out.includes("привет"));
  assert.ok(out.includes("ça va? 🚀"));
});

test("telegram preview includes resolved chat name and text", () => {
  const out = formatTelegramPreview({
    chat: "@alex_m",
    resolved_chat_name: "Alex Rivers",
    text: "hi there",
  });
  assert.match(out, /^Chat: Alex Rivers$/m);
  assert.ok(out.includes("\n\nhi there"));
});

test("telegram preview falls back to raw chat input when no resolved name", () => {
  const out = formatTelegramPreview({
    chat: "@alex_m",
    text: "hi",
  });
  assert.match(out, /^Chat: @alex_m$/m);
});

test("telegram preview shows reply_to_message_id when set", () => {
  const out = formatTelegramPreview({
    resolved_chat_name: "Alex",
    text: "re: yours",
    reply_to_message_id: 77,
  });
  assert.match(out, /Reply to: msg 77/);
});

test("telegram preview omits reply_to line when not set", () => {
  const out = formatTelegramPreview({
    resolved_chat_name: "Alex",
    text: "hi",
  });
  assert.equal(out.includes("Reply to:"), false);
});
