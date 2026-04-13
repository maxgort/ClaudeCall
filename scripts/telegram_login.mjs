#!/usr/bin/env node
// Interactive Telegram user-account login for ClaudeCall.
//
// Usage:
//   node scripts/telegram_login.mjs
//
// Reads TELEGRAM_API_ID and TELEGRAM_API_HASH from ~/.claudecall/config.env
// (get them at https://my.telegram.org → API development tools).
// Prompts for phone number, SMS/in-app code, and optional 2FA password.
// On success, writes the session string back into config.env under
// TELEGRAM_SESSION.

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { getConfigEnv } from "../skill/scripts/paths.mjs";
import { loadConfig } from "../mcps/shared/config.mjs";
import { persistEnvValues } from "../skill/scripts/env_file.mjs";

const CONFIG_ENV = getConfigEnv();
const rl = createInterface({ input, output });

async function ask(prompt, { hidden = false } = {}) {
  if (!hidden) return (await rl.question(prompt)).trim();
  // Hide input for passwords — simple approach: mute stdout echo.
  process.stdout.write(prompt);
  const orig = output.write.bind(output);
  output.write = (chunk, enc, cb) => {
    if (typeof chunk === "string" && chunk !== "\r\n" && chunk !== "\n")
      return orig("", enc, cb);
    return orig(chunk, enc, cb);
  };
  const answer = await new Promise((resolve) => {
    rl.once("line", (line) => resolve(line));
  });
  output.write = orig;
  process.stdout.write("\n");
  return answer.trim();
}

async function main() {
  console.log("=== ClaudeCall Telegram login ===");
  console.log();

  const config = loadConfig();
  let apiId = config.TELEGRAM_API_ID;
  let apiHash = config.TELEGRAM_API_HASH;

  if (!apiId || !apiHash) {
    console.log("TELEGRAM_API_ID / TELEGRAM_API_HASH missing from config.env.");
    console.log("Get them at https://my.telegram.org → API development tools.");
    console.log();
    apiId = apiId || (await ask("TELEGRAM_API_ID: "));
    apiHash = apiHash || (await ask("TELEGRAM_API_HASH: "));
  } else {
    console.log("Using api_id / api_hash from config.env.");
  }

  const client = new TelegramClient(
    new StringSession(""),
    Number(apiId),
    apiHash,
    { connectionRetries: 3 }
  );

  await client.start({
    phoneNumber: () => ask("Phone number (e.g. +79001234567): "),
    password: () => ask("2FA password (if enabled, else blank): ", { hidden: true }),
    phoneCode: () => ask("Code from Telegram: "),
    onError: (err) => {
      console.error("Auth error: " + err.message);
      throw err;
    },
  });

  const session = client.session.save();
  const me = await client.getMe();

  persistEnvValues(CONFIG_ENV, {
    TELEGRAM_API_ID: String(apiId),
    TELEGRAM_API_HASH: apiHash,
    TELEGRAM_SESSION: session,
  });

  console.log();
  console.log("=== Logged in ===");
  console.log(
    "Account: " +
      (me.firstName || "") +
      (me.lastName ? " " + me.lastName : "") +
      (me.username ? " (@" + me.username + ")" : "")
  );
  console.log("Session saved to " + CONFIG_ENV);
  console.log();
  console.log("You can now use the telegram MCP. Session never expires");
  console.log("unless you log out from another device or run this again.");

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL: " + err.message);
  process.exit(1);
});
