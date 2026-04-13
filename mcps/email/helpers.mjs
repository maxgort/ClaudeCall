import nodemailer from "nodemailer";

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
