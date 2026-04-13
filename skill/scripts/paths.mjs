import { homedir } from "node:os";
import { join } from "node:path";

// ROOT is resolved dynamically so tests can override via CLAUDECALL_ROOT
// without needing to re-import this module.
export function getRoot() {
  return process.env.CLAUDECALL_ROOT || join(homedir(), ".claudecall");
}

export function getConfigEnv() {
  return join(getRoot(), "config.env");
}
export function getProfile() {
  return join(getRoot(), "profile.json");
}
export function getHistory() {
  return join(getRoot(), "history.json");
}
export function getPending() {
  return join(getRoot(), "pending.json");
}

// Back-compat constants. Resolved once at module load — fine for runtime code
// (MCP servers, installer) that never changes CLAUDECALL_ROOT mid-process.
// Tests should use the getters above.
export const ROOT = getRoot();
export const CONFIG_ENV = getConfigEnv();
export const PROFILE = getProfile();
export const HISTORY = getHistory();
export const PENDING = getPending();
