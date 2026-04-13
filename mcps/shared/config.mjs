import { readFileSync, existsSync } from "node:fs";
import { getConfigEnv } from "../../skill/scripts/paths.mjs";

// Config keys we look at. When running as an MCPB bundle, Claude Desktop
// injects these via process.env from the extension's user_config form. When
// running from a git checkout, they come from ~/.claudecall/config.env.
const CONFIG_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "VAPI_API_KEY",
  "VAPI_PHONE_NUMBER_ID",
  "VAPI_ASSISTANT_ID",
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_SESSION",
];

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Merged config: env vars win over config.env file. MCPB bundles always
// provide env vars; git checkouts usually have config.env.
export function loadConfig() {
  const fromFile = parseEnvFile(getConfigEnv());
  const merged = { ...fromFile };
  for (const key of CONFIG_KEYS) {
    const envVal = process.env[key];
    if (envVal != null && envVal !== "") merged[key] = envVal;
  }
  return merged;
}

export function requireKeys(config, keys, channel) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(
      `[${channel}] Missing config keys: ${missing.join(", ")}. ` +
        `Edit ~/.claudecall/config.env and restart Claude Desktop.`
    );
  }
}
