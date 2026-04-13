#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRoot,
  getHistory,
  getPending,
  getProfile,
  getConfigEnv,
} from "./paths.mjs";

const ROOT = getRoot();
const HISTORY = getHistory();
const PENDING = getPending();
const PROFILE = getProfile();
const CONFIG_ENV = getConfigEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const PROFILE_EXAMPLE = join(SKILL_DIR, "profile.example.json");

function ensureFile(path, content) {
  if (existsSync(path)) return false;
  writeFileSync(path, content, "utf8");
  return true;
}

mkdirSync(ROOT, { recursive: true });

const created = [];

if (ensureFile(HISTORY, JSON.stringify({ entries: [] }, null, 2))) {
  created.push(HISTORY);
}

if (ensureFile(PENDING, JSON.stringify({ entries: [] }, null, 2))) {
  created.push(PENDING);
}

if (!existsSync(PROFILE) && existsSync(PROFILE_EXAMPLE)) {
  copyFileSync(PROFILE_EXAMPLE, PROFILE);
  created.push(PROFILE);
}

if (
  ensureFile(
    CONFIG_ENV,
    [
      "# ClaudeCall credentials — filled in by the installer.",
      "# Email (SMTP)",
      "SMTP_HOST=",
      "SMTP_PORT=465",
      "SMTP_USER=",
      "SMTP_PASS=",
      'SMTP_FROM=""',
      "",
      "# Voice (Vapi)",
      "VAPI_API_KEY=",
      "VAPI_PHONE_NUMBER_ID=",
      "VAPI_ASSISTANT_ID=",
      "",
      "# Telegram — user account via MTProto",
      "# Get api_id / api_hash at https://my.telegram.org",
      "# Then run: node scripts/telegram_login.mjs (populates TELEGRAM_SESSION)",
      "TELEGRAM_API_ID=",
      "TELEGRAM_API_HASH=",
      "TELEGRAM_SESSION=",
      "",
    ].join("\n")
  )
) {
  created.push(CONFIG_ENV);
}

console.log(`ClaudeCall initialized at ${ROOT}`);
if (created.length) {
  console.log("Created:");
  for (const f of created) console.log("  " + f);
} else {
  console.log("All files already present. Nothing to do.");
}
console.log("\nNext: edit " + PROFILE + " to match your style.");
console.log("Then: fill in " + CONFIG_ENV + " with your credentials.");
