import { test } from "node:test";
import assert from "node:assert/strict";

import { textReply, jsonReply, errorReply } from "../../mcps/shared/reply.mjs";

test("textReply wraps plain string", () => {
  const r = textReply("hello");
  assert.deepEqual(r, { content: [{ type: "text", text: "hello" }] });
  assert.ok(!r.isError, "not an error reply");
});

test("jsonReply serializes with 2-space indent", () => {
  const r = jsonReply({ a: 1, b: [2, 3] });
  assert.equal(r.content[0].type, "text");
  assert.equal(r.content[0].text, JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
});

test("errorReply sets isError flag and prefixes message", () => {
  const r = errorReply("something broke");
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, "ERROR: something broke");
});
