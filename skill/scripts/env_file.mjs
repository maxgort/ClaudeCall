// Shared helpers for reading / writing ~/.claudecall/config.env as a plain
// .env file. Used by setup.mjs, telegram_login.mjs, calendar_login.mjs.

import { readFileSync, writeFileSync } from "node:fs";

// Insert or replace a KEY=value line in a .env text blob. Values with spaces
// or # get automatically quoted with double quotes.
export function upsertEnvLine(raw, key, value) {
  const lines = (raw || "").split(/\r?\n/);
  const pattern = new RegExp("^" + key + "\\s*=");
  let found = false;
  const quoted =
    value && (String(value).includes(" ") || String(value).includes("#"))
      ? `"${value}"`
      : String(value);
  const newLine = `${key}=${quoted}`;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i].trim())) {
      lines[i] = newLine;
      found = true;
      break;
    }
  }
  if (!found) lines.push(newLine);
  return lines.join("\n");
}

// Read a .env file safely, returning "" on any failure.
export function readEnvFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Persist a single key-value pair into the config.env at `path`, creating
// the file if it doesn't exist.
export function persistEnvValue(path, key, value) {
  const raw = readEnvFile(path);
  const next = upsertEnvLine(raw, key, value);
  writeFileSync(path, next, "utf8");
}

// Persist multiple key-value pairs in one write.
export function persistEnvValues(path, obj) {
  let raw = readEnvFile(path);
  for (const [key, value] of Object.entries(obj)) {
    raw = upsertEnvLine(raw, key, value);
  }
  writeFileSync(path, raw, "utf8");
}
