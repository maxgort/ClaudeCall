#!/usr/bin/env node
// Patches Claude Desktop's config to register the ClaudeCall MCP servers.
//
// Detects the config path by OS, merges our mcpServers entries without
// clobbering existing ones, and backs up the original.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Windows Claude Desktop has two install modes:
//   1. Classic .exe installer     → %APPDATA%\Claude\claude_desktop_config.json
//   2. Microsoft Store (MSIX)     → %LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\
//                                   LocalCache\Roaming\Claude\claude_desktop_config.json
// MSIX virtualizes the filesystem, so the classic path is invisible to it.
// We detect by looking for the Claude_pzs8sxrjxfjjc package directory.
export const CLAUDE_MSIX_PACKAGE = "Claude_pzs8sxrjxfjjc";

export function claudeConfigPath(platform, env = process.env, fs = null) {
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  }
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const msixPath = join(
      localAppData,
      "Packages",
      CLAUDE_MSIX_PACKAGE,
      "LocalCache",
      "Roaming",
      "Claude",
      "claude_desktop_config.json"
    );
    // Default to MSIX path if the package directory exists.
    const msixDir = join(localAppData, "Packages", CLAUDE_MSIX_PACKAGE);
    const checker = fs || { existsSync };
    if (checker.existsSync(msixDir)) return msixPath;
    const appData = env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

export function buildServerEntries(repoRoot, nodeBin) {
  return {
    "claudecall-core": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "core", "index.mjs")],
    },
    "claudecall-email": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "email", "index.mjs")],
    },
    "claudecall-voice": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "voice", "index.mjs")],
    },
    "claudecall-telegram": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "telegram", "index.mjs")],
    },
    "claudecall-slack": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "slack", "index.mjs")],
    },
    "claudecall-calendar": {
      command: nodeBin,
      args: [join(repoRoot, "mcps", "calendar", "index.mjs")],
    },
  };
}

export function run({
  configPath,
  repoRoot,
  nodeBin = process.execPath,
  logger = console,
} = {}) {
  if (!configPath) throw new Error("run() requires configPath");
  if (!repoRoot) throw new Error("run() requires repoRoot");

  mkdirSync(dirname(configPath), { recursive: true });

  let existing = { mcpServers: {} };
  let backupPath = null;

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      logger.warn(
        "Existing config at " + configPath + " is not valid JSON — backing up."
      );
      existing = { mcpServers: {} };
    }
    backupPath = configPath + ".claudecall-backup." + Date.now();
    copyFileSync(configPath, backupPath);
    logger.log("Backed up existing config to " + backupPath);
  }

  if (!existing.mcpServers) existing.mcpServers = {};

  const servers = buildServerEntries(repoRoot, nodeBin);
  for (const [name, def] of Object.entries(servers)) {
    existing.mcpServers[name] = def;
  }

  writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf8");
  logger.log("Wrote " + configPath);
  logger.log(
    "Registered " +
      Object.keys(servers).length +
      " MCP servers: " +
      Object.keys(servers).join(", ")
  );

  return { configPath, backupPath, servers: Object.keys(servers) };
}

// CLI entry point.
const __filename = fileURLToPath(import.meta.url);
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (invokedDirectly) {
  const __dirname = dirname(__filename);
  const repoRoot = resolve(__dirname, "..", "..");
  const configPath = claudeConfigPath(osPlatform());
  run({ configPath, repoRoot });
  console.log("\nRestart Claude Desktop for changes to take effect.");
}
