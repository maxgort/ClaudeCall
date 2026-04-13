import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";

import { sendEmail } from "../../mcps/email/helpers.mjs";

// Use nodemailer's built-in jsonTransport to capture what would be sent
// without touching the network.
function jsonTransporter() {
  return nodemailer.createTransport({ jsonTransport: true });
}

test("sendEmail passes core fields to nodemailer", async () => {
  const info = await sendEmail(
    { SMTP_FROM: "Alex <alex@example.com>" },
    {
      to: "bob@example.com",
      subject: "Hello",
      body: "Body text.",
    },
    { transporter: jsonTransporter() }
  );

  const envelope = JSON.parse(info.message);
  assert.equal(envelope.from.address, "alex@example.com");
  assert.deepEqual(
    envelope.to.map((a) => a.address),
    ["bob@example.com"]
  );
  assert.equal(envelope.subject, "Hello");
  assert.equal(envelope.text, "Body text.");
});

test("sendEmail falls back to SMTP_USER when SMTP_FROM missing", async () => {
  const info = await sendEmail(
    { SMTP_USER: "alex@example.com" },
    { to: "b@example.com", subject: "s", body: "b" },
    { transporter: jsonTransporter() }
  );
  const envelope = JSON.parse(info.message);
  assert.equal(envelope.from.address, "alex@example.com");
});

test("sendEmail propagates cc and bcc", async () => {
  const info = await sendEmail(
    { SMTP_USER: "alex@example.com" },
    {
      to: "b@example.com",
      cc: "c@example.com",
      bcc: "d@example.com",
      subject: "s",
      body: "b",
    },
    { transporter: jsonTransporter() }
  );
  const envelope = JSON.parse(info.message);
  assert.equal(envelope.cc[0].address, "c@example.com");
  assert.equal(envelope.bcc[0].address, "d@example.com");
});

test("sendEmail propagates reply_to_message_id as inReplyTo", async () => {
  const info = await sendEmail(
    { SMTP_USER: "alex@example.com" },
    {
      to: "b@example.com",
      subject: "s",
      body: "b",
      reply_to_message_id: "<abc@example.com>",
    },
    { transporter: jsonTransporter() }
  );
  const envelope = JSON.parse(info.message);
  assert.equal(envelope.inReplyTo, "<abc@example.com>");
});

test("sendEmail surfaces transport errors", async () => {
  const failingTransporter = {
    sendMail: async () => {
      throw new Error("connection refused");
    },
  };
  await assert.rejects(
    () =>
      sendEmail(
        { SMTP_USER: "a@b.com" },
        { to: "b@c.com", subject: "s", body: "b" },
        { transporter: failingTransporter }
      ),
    /connection refused/
  );
});
