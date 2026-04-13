import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

export function formatEmailPreview(p) {
  return [
    "To:      " + p.to,
    p.cc ? "Cc:      " + p.cc : null,
    p.bcc ? "Bcc:     " + p.bcc : null,
    "Subject: " + p.subject,
    "",
    p.body,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export function createMailTransport(config) {
  const port = Number(config.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
}

// Pure send function. Takes an optional transporter for tests (e.g. a
// nodemailer jsonTransport). Throws on SMTP error; returns the info object
// nodemailer produces on success.
export async function sendEmail(config, payload, { transporter } = {}) {
  const mailer = transporter || createMailTransport(config);
  return mailer.sendMail({
    from: config.SMTP_FROM || config.SMTP_USER,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.body,
    inReplyTo: payload.reply_to_message_id,
  });
}

// -----------------------------------------------------------------------------
// IMAP reading
// -----------------------------------------------------------------------------

export class ImapError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "ImapError";
    if (cause) this.cause = cause;
  }
}

export function createImapClient(config) {
  if (!config.IMAP_HOST || !config.IMAP_USER || !config.IMAP_PASS) {
    throw new ImapError(
      "IMAP_HOST / IMAP_USER / IMAP_PASS missing in config. For Gmail use imap.gmail.com:993 with the same app password as SMTP."
    );
  }
  return new ImapFlow({
    host: config.IMAP_HOST,
    port: Number(config.IMAP_PORT || 993),
    secure: Number(config.IMAP_PORT || 993) === 993,
    auth: {
      user: config.IMAP_USER,
      pass: config.IMAP_PASS,
    },
    logger: false,
  });
}

function shortenAddr(addr) {
  if (!addr) return null;
  if (typeof addr === "string") return addr;
  if (Array.isArray(addr)) return addr.map(shortenAddr).filter(Boolean).join(", ");
  const name = addr.name || "";
  const a = addr.address || "";
  return name ? `${name} <${a}>` : a;
}

function envelopeToSummary(msg) {
  const env = msg.envelope || {};
  return {
    uid: msg.uid,
    message_id: env.messageId || null,
    in_reply_to: env.inReplyTo || null,
    from: shortenAddr(env.from),
    to: shortenAddr(env.to),
    cc: shortenAddr(env.cc),
    subject: env.subject || "(no subject)",
    date: env.date ? new Date(env.date).toISOString() : null,
    flags: Array.isArray(msg.flags) ? msg.flags : Array.from(msg.flags || []),
    seen: msg.flags?.has?.("\\Seen") || msg.flags?.includes?.("\\Seen") || false,
    preview: (msg.bodyText || msg.body || "").slice(0, 200),
  };
}

// Lists recent unread messages from INBOX.
export async function listUnread(
  client,
  { limit = 10, mailbox = "INBOX" } = {}
) {
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      const slice = (uids || []).slice(-limit).reverse();
      const results = [];
      for await (const msg of client.fetch(
        slice,
        { uid: true, envelope: true, flags: true, bodyParts: ["TEXT"] },
        { uid: true }
      )) {
        let bodyText = "";
        if (msg.bodyParts && msg.bodyParts.get("TEXT")) {
          bodyText = msg.bodyParts.get("TEXT").toString("utf8");
        }
        results.push(envelopeToSummary({ ...msg, bodyText }));
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Search by "from", "subject", "since" (ISO date), "unseen" flag.
export async function searchMessages(
  client,
  query = {},
  { limit = 20, mailbox = "INBOX" } = {}
) {
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const criteria = {};
      if (query.from) criteria.from = query.from;
      if (query.to) criteria.to = query.to;
      if (query.subject) criteria.subject = query.subject;
      if (query.body) criteria.body = query.body;
      if (query.since) criteria.since = new Date(query.since);
      if (query.unseen) criteria.seen = false;
      if (Object.keys(criteria).length === 0) criteria.all = true;

      const uids = await client.search(criteria, { uid: true });
      const slice = (uids || []).slice(-limit).reverse();
      const results = [];
      for await (const msg of client.fetch(
        slice,
        { uid: true, envelope: true, flags: true, bodyParts: ["TEXT"] },
        { uid: true }
      )) {
        let bodyText = "";
        if (msg.bodyParts && msg.bodyParts.get("TEXT")) {
          bodyText = msg.bodyParts.get("TEXT").toString("utf8");
        }
        results.push(envelopeToSummary({ ...msg, bodyText }));
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Fetch a single full message by UID — including full body, not just preview.
export async function readMessage(
  client,
  uid,
  { mailbox = "INBOX" } = {}
) {
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        uid,
        { uid: true, envelope: true, flags: true, source: true, bodyParts: ["TEXT"] },
        { uid: true }
      );
      if (!msg) return null;
      let bodyText = "";
      if (msg.bodyParts && msg.bodyParts.get("TEXT")) {
        bodyText = msg.bodyParts.get("TEXT").toString("utf8");
      }
      return {
        ...envelopeToSummary({ ...msg, bodyText }),
        body_full: bodyText,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Mark a message as read (adds \\Seen flag).
export async function markSeen(client, uid, { mailbox = "INBOX" } = {}) {
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
