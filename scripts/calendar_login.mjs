#!/usr/bin/env node
// Interactive Google Calendar OAuth2 login for ClaudeCall.
//
// Usage:
//   node scripts/calendar_login.mjs
//
// Prereq: a Google Cloud project with the Calendar API enabled and an OAuth
// 2.0 Client ID of type "Desktop app". Add your GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET to ~/.claudecall/config.env first.
//
// Flow:
//   1. Starts a tiny local HTTP server on a random port
//   2. Opens your browser to Google's consent page
//   3. Google redirects back with an auth code
//   4. We exchange the code for a refresh token
//   5. Refresh token is saved back to config.env as GOOGLE_CALENDAR_REFRESH_TOKEN

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";

import { google } from "googleapis";

import { getConfigEnv } from "../skill/scripts/paths.mjs";
import { loadConfig } from "../mcps/shared/config.mjs";
import { GOOGLE_SCOPES } from "../mcps/calendar/helpers.mjs";

const CONFIG_ENV = getConfigEnv();

function upsertEnvLine(raw, key, value) {
  const lines = raw.split(/\r?\n/);
  const pattern = new RegExp("^" + key + "\\s*=");
  let found = false;
  const quoted =
    value && (value.includes(" ") || value.includes("#"))
      ? `"${value}"`
      : value;
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

function openUrl(url) {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${url.replace(/&/g, "^&")}"`);
  } else if (platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

async function main() {
  console.log("=== ClaudeCall Google Calendar login ===\n");

  const config = loadConfig();
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    console.error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in config.env."
    );
    console.error(
      "Create a 'Desktop app' OAuth client at https://console.cloud.google.com/apis/credentials"
    );
    console.error("and add both values to ~/.claudecall/config.env first.");
    process.exit(1);
  }

  // Start temp HTTP server and wait for the Google redirect.
  const { server, port, redirectUri, codePromise } = await startCallbackServer();

  const oauth2 = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });

  console.log("Opening browser for consent...");
  console.log("If the browser does not open, paste this URL manually:\n");
  console.log(authUrl);
  console.log();
  openUrl(authUrl);

  const code = await codePromise;
  server.close();

  console.log("Got auth code, exchanging for refresh token...");
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token in the response. You may have already consented; revoke the app at https://myaccount.google.com/permissions and try again."
    );
    process.exit(1);
  }

  let raw = "";
  try {
    raw = readFileSync(CONFIG_ENV, "utf8");
  } catch {
    raw = "";
  }
  raw = upsertEnvLine(
    raw,
    "GOOGLE_CALENDAR_REFRESH_TOKEN",
    tokens.refresh_token
  );
  writeFileSync(CONFIG_ENV, raw);

  console.log("\n=== Logged in ===");
  console.log("Refresh token saved to " + CONFIG_ENV);
  console.log("You can now use the calendar MCP.");
  process.exit(0);
}

function startCallbackServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (err) {
        res.end(
          "<h2>Error</h2><p>" + err + "</p><p>You can close this tab.</p>"
        );
        done && done({ error: err });
        return;
      }
      if (code) {
        res.end(
          "<h2>ClaudeCall login complete</h2><p>You can close this tab and go back to the terminal.</p>"
        );
        done && done({ code });
      }
    });
    let done = null;
    const codePromise = new Promise((resolveCode) => {
      done = (v) => {
        if (v.error) {
          console.error("OAuth error: " + v.error);
          process.exit(1);
        }
        resolveCode(v.code);
      };
    });
    server.listen(0, () => {
      const port = server.address().port;
      const redirectUri = "http://localhost:" + port + "/oauth2callback";
      resolve({ server, port, redirectUri, codePromise });
    });
  });
}

main().catch((err) => {
  console.error("FATAL: " + err.message);
  process.exit(1);
});
