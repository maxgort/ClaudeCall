#!/usr/bin/env node
// ClaudeCall interactive setup wizard.
//
// Usage:
//   npm install
//   npm run setup
//
// Walks through each channel, opens the relevant signup/config page in the
// user's browser, collects the credentials, writes them to config.env, runs
// any required OAuth login flows, and registers the MCP servers with Claude
// Desktop at the end.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, exec } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, platform } from "node:process";

import {
  getRoot,
  getConfigEnv,
  getProfile,
} from "../skill/scripts/paths.mjs";
import { persistEnvValues, readEnvFile } from "../skill/scripts/env_file.mjs";
import { loadConfig } from "../mcps/shared/config.mjs";
import {
  run as runInstallConfig,
  claudeConfigPath,
} from "../skill/scripts/install_config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILL_DIR = resolve(REPO_ROOT, "skill");
const PROFILE_EXAMPLE = resolve(SKILL_DIR, "profile.example.json");

const rl = createInterface({ input, output });

// ---------- tiny TTY helpers ----------

function h1(text) {
  console.log("\n\x1b[1m\x1b[36m== " + text + " ==\x1b[0m");
}
function h2(text) {
  console.log("\n\x1b[1m" + text + "\x1b[0m");
}
function dim(text) {
  console.log("\x1b[2m" + text + "\x1b[0m");
}
function ok(text) {
  console.log("\x1b[32m✓\x1b[0m " + text);
}
function warn(text) {
  console.log("\x1b[33m!\x1b[0m " + text);
}
function err(text) {
  console.log("\x1b[31m✗\x1b[0m " + text);
}

async function ask(prompt, { def = "" } = {}) {
  const suffix = def ? ` [${def}]` : "";
  const answer = (await rl.question(prompt + suffix + " ")).trim();
  return answer || def;
}

async function askYesNo(prompt, { def = false } = {}) {
  const suffix = def ? " [Y/n]" : " [y/N]";
  while (true) {
    const raw = (await rl.question(prompt + suffix + " ")).trim().toLowerCase();
    if (!raw) return def;
    if (["y", "yes", "да", "д"].includes(raw)) return true;
    if (["n", "no", "нет", "н"].includes(raw)) return false;
    warn("Please answer y or n.");
  }
}

function openUrl(url) {
  dim("  opening: " + url);
  if (platform === "win32") {
    exec(`start "" "${url.replace(/&/g, "^&")}"`);
  } else if (platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

async function runNodeScript(script) {
  return new Promise((resolveProc, rejectProc) => {
    const child = spawn(process.execPath, [resolve(REPO_ROOT, script)], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) resolveProc();
      else rejectProc(new Error(script + " exited with code " + code));
    });
    child.on("error", rejectProc);
  });
}

// ---------- prerequisites ----------

function checkNodeModules() {
  const nm = resolve(REPO_ROOT, "node_modules");
  if (!existsSync(nm)) {
    err("node_modules/ not found. Run `npm install` first.");
    process.exit(1);
  }
}

function bootstrapRoot() {
  const root = getRoot();
  mkdirSync(root, { recursive: true });
  const configPath = getConfigEnv();
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      "# ClaudeCall credentials (populated by setup wizard)\n",
      "utf8"
    );
  }
  const profilePath = getProfile();
  if (!existsSync(profilePath) && existsSync(PROFILE_EXAMPLE)) {
    writeFileSync(profilePath, readFileSync(PROFILE_EXAMPLE, "utf8"));
    ok("Seeded profile at " + profilePath + " (edit it to match your style)");
  }
  return { root, configPath };
}

// ---------- channel wizards ----------

async function setupEmail(configPath, existing) {
  h1("Email — SMTP out + IMAP in (Gmail, Outlook, any provider)");
  const has = existing.SMTP_USER && existing.SMTP_PASS;
  if (has) {
    dim("  already configured for " + existing.SMTP_USER);
    const re = await askYesNo("Reconfigure email?", { def: false });
    if (!re) return;
  }

  console.log(
    "\n  For Gmail you need an \x1b[1mapp password\x1b[0m (16-char) — not your normal password."
  );
  console.log(
    "  Requires 2-factor auth on the account. Opening the Google page now..."
  );
  openUrl("https://myaccount.google.com/apppasswords");
  console.log();

  const user = await ask("  Your email address (e.g. you@gmail.com):", {
    def: existing.SMTP_USER || "",
  });
  if (!user) {
    warn("  Skipping email — no address provided.");
    return;
  }
  const pass = await ask("  App password / SMTP password:", {
    def: existing.SMTP_PASS || "",
  });
  if (!pass) {
    warn("  Skipping email — no password provided.");
    return;
  }

  // Sane defaults for Gmail.
  const isGmail = /@gmail\.com$/i.test(user);
  const smtpHost = isGmail ? "smtp.gmail.com" : await ask("  SMTP host:", {
    def: existing.SMTP_HOST || "",
  });
  const smtpPort = isGmail ? "587" : (await ask("  SMTP port:", { def: existing.SMTP_PORT || "587" }));
  const imapHost = isGmail
    ? "imap.gmail.com"
    : await ask("  IMAP host:", { def: existing.IMAP_HOST || "" });
  const imapPort = isGmail ? "993" : (await ask("  IMAP port:", { def: existing.IMAP_PORT || "993" }));

  // Strip spaces from Gmail app passwords — Google shows them with spaces.
  const cleanPass = pass.replace(/\s+/g, "");

  persistEnvValues(configPath, {
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_USER: user,
    SMTP_PASS: cleanPass,
    IMAP_HOST: imapHost,
    IMAP_PORT: imapPort,
    IMAP_USER: user,
    IMAP_PASS: cleanPass,
  });
  ok("Email saved — both send (SMTP) and read (IMAP) enabled.");
}

async function setupTelegram(configPath, existing) {
  h1("Telegram — user account via MTProto");

  const hasSession = !!existing.TELEGRAM_SESSION;
  if (hasSession) {
    dim("  already logged in (session saved)");
    const re = await askYesNo("Reconfigure Telegram?", { def: false });
    if (!re) return;
  }

  console.log(
    "\n  Opens your real Telegram account (not a bot). You'll need:"
  );
  console.log("    1. api_id and api_hash from https://my.telegram.org");
  console.log("    2. A code Telegram will send to your phone");
  console.log();
  openUrl("https://my.telegram.org");

  const apiId = await ask("  Telegram api_id (number):", {
    def: existing.TELEGRAM_API_ID || "",
  });
  if (!apiId) {
    warn("  Skipping Telegram — no api_id.");
    return;
  }
  const apiHash = await ask("  Telegram api_hash (32 chars):", {
    def: existing.TELEGRAM_API_HASH || "",
  });
  if (!apiHash) {
    warn("  Skipping Telegram — no api_hash.");
    return;
  }
  persistEnvValues(configPath, {
    TELEGRAM_API_ID: apiId,
    TELEGRAM_API_HASH: apiHash,
  });

  console.log(
    "\n  Now running the interactive login — Telegram will send a code to your app."
  );
  try {
    await runNodeScript("scripts/telegram_login.mjs");
    ok("Telegram logged in.");
  } catch (e) {
    err("Telegram login failed: " + e.message);
    warn("  You can retry later with: node scripts/telegram_login.mjs");
  }
}

async function setupSlack(configPath, existing) {
  h1("Slack — workspace bot");

  if (existing.SLACK_BOT_TOKEN) {
    dim("  already has a bot token");
    const re = await askYesNo("Reconfigure Slack?", { def: false });
    if (!re) return;
  }

  console.log(
    "\n  1. Go to https://api.slack.com/apps → Create New App → From scratch"
  );
  console.log("  2. Pick a name and your workspace");
  console.log(
    "  3. OAuth & Permissions → add bot scopes: chat:write, channels:read, users:read, im:write"
  );
  console.log("  4. Install to Workspace");
  console.log("  5. Copy the 'Bot User OAuth Token' (xoxb-...)");
  console.log();
  openUrl("https://api.slack.com/apps");

  const token = await ask("  Bot User OAuth Token (xoxb-...):");
  if (!token) {
    warn("  Skipping Slack — no token.");
    return;
  }
  persistEnvValues(configPath, { SLACK_BOT_TOKEN: token });
  ok("Slack saved. Remember to invite your bot to any channel you want it to post in (/invite @YourBot).");
}

async function setupCalendar(configPath, existing) {
  h1("Google Calendar — read + create + update events");

  if (existing.GOOGLE_CALENDAR_REFRESH_TOKEN) {
    dim("  already has a refresh token");
    const re = await askYesNo("Reconfigure Calendar?", { def: false });
    if (!re) return;
  }

  console.log("\n  1. Enable the Calendar API (button in the page that opens)");
  openUrl(
    "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
  );
  await ask("  Press Enter after you click Enable...");

  console.log(
    "\n  2. Create an OAuth client: Type = 'Desktop app', any name"
  );
  openUrl("https://console.cloud.google.com/apis/credentials");
  await ask("  Press Enter when you have the Client ID and Client Secret...");

  const clientId = await ask("  Google Client ID:");
  if (!clientId) {
    warn("  Skipping Calendar — no client id.");
    return;
  }
  const clientSecret = await ask("  Google Client Secret:");
  if (!clientSecret) {
    warn("  Skipping Calendar — no client secret.");
    return;
  }
  persistEnvValues(configPath, {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  });

  console.log(
    "\n  3. Running OAuth consent — a browser tab will open for approval."
  );
  try {
    await runNodeScript("scripts/calendar_login.mjs");
    ok("Calendar connected.");
  } catch (e) {
    err("Calendar login failed: " + e.message);
    warn("  You can retry later with: node scripts/calendar_login.mjs");
  }
}

async function setupVapi(configPath, existing) {
  h1("Voice calls — Vapi");

  if (existing.VAPI_API_KEY) {
    dim("  already has a Vapi key");
    const re = await askYesNo("Reconfigure Vapi?", { def: false });
    if (!re) return;
  }

  console.log(
    "\n  1. Sign up at dashboard.vapi.ai (free tier has US numbers)"
  );
  console.log("  2. Settings → API Keys → copy your key");
  console.log("  3. Phone Numbers → buy one (or use free tier) → copy its ID");
  console.log("  4. Assistants → create one → copy its ID");
  console.log("\n  Calls cost ~$0.10-0.30 per minute.");
  console.log();
  openUrl("https://dashboard.vapi.ai");

  const apiKey = await ask("  Vapi API key:");
  if (!apiKey) {
    warn("  Skipping Vapi — no key.");
    return;
  }
  const phoneId = await ask("  Vapi phone number ID:");
  if (!phoneId) {
    warn("  Skipping Vapi — no phone id.");
    return;
  }
  const assistantId = await ask("  Vapi assistant ID:");
  if (!assistantId) {
    warn("  Skipping Vapi — no assistant id.");
    return;
  }
  persistEnvValues(configPath, {
    VAPI_API_KEY: apiKey,
    VAPI_PHONE_NUMBER_ID: phoneId,
    VAPI_ASSISTANT_ID: assistantId,
  });
  ok("Vapi saved.");
}

// ---------- main flow ----------

async function main() {
  h1("ClaudeCall setup wizard");
  console.log(
    "\nThis wizard will walk you through each channel one at a time."
  );
  console.log(
    "You can skip any channel by answering 'n' and come back to it later."
  );
  console.log("Everything is saved locally — nothing is sent to any server.\n");

  checkNodeModules();
  const { configPath } = bootstrapRoot();
  ok("State directory ready at " + getRoot());

  const existing = loadConfig();

  h1("Step 1 — choose channels");
  const want = {
    email: await askYesNo("Set up Email (send + read inbox)?", { def: true }),
    telegram: await askYesNo(
      "Set up Telegram (your real account, not a bot)?",
      { def: true }
    ),
    slack: await askYesNo("Set up Slack (team channel messaging)?", {
      def: false,
    }),
    calendar: await askYesNo(
      "Set up Google Calendar (read + create events)?",
      { def: false }
    ),
    vapi: await askYesNo("Set up Voice calls via Vapi (paid)?", {
      def: false,
    }),
  };

  if (want.email) await setupEmail(configPath, existing);
  if (want.telegram) await setupTelegram(configPath, loadConfig());
  if (want.slack) await setupSlack(configPath, loadConfig());
  if (want.calendar) await setupCalendar(configPath, loadConfig());
  if (want.vapi) await setupVapi(configPath, loadConfig());

  h1("Step 2 — register with Claude Desktop");
  try {
    const result = runInstallConfig({
      configPath: claudeConfigPath(platform),
      repoRoot: REPO_ROOT,
    });
    ok("Patched " + result.configPath);
    ok("Registered " + result.servers.length + " MCP servers");
  } catch (e) {
    err("Claude Desktop patch failed: " + e.message);
    warn(
      "  Manual fix: run `node skill/scripts/install_config.mjs` after closing Claude Desktop."
    );
  }

  h1("Done");
  console.log(
    "\n  1. \x1b[1mQuit Claude Desktop completely\x1b[0m (tray icon → Quit, not just close the window)"
  );
  console.log("  2. Start it again");
  console.log(
    "  3. In a new chat, try one of these depending on what you set up:"
  );
  if (want.email)
    console.log(
      '       "Show me my unread emails"\n       "Draft an email to yourself saying hi"'
    );
  if (want.telegram)
    console.log('       "List my recent Telegram chats"');
  if (want.slack)
    console.log('       "What Slack channels is the bot in?"');
  if (want.calendar)
    console.log('       "What meetings do I have tomorrow?"');
  if (want.vapi)
    console.log('       "Place a test call to my own number saying just hi"');
  console.log();
  console.log(
    "  Claude will preview each action and wait for your explicit approval before anything sends."
  );
  console.log();
  console.log(
    "  Config lives at " +
      configPath +
      " — edit it directly if you ever need to rotate creds."
  );
  console.log();

  rl.close();
  process.exit(0);
}

main().catch((e) => {
  err("FATAL: " + e.message);
  process.exit(1);
});
