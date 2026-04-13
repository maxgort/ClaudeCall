import { spawn } from "node:child_process";

// Minimal stdio JSON-RPC client for MCP servers. Spawns the server, runs a
// handshake, lets you call tools by name, and cleanly shuts it down.
//
// Usage:
//   const client = await spawnMcp("mcps/core/index.mjs", { CLAUDECALL_ROOT: root });
//   const tools = await client.listTools();
//   const result = await client.callTool("load_profile", {});
//   await client.close();

export async function spawnMcp(serverPath, env = {}) {
  const proc = spawn(process.execPath, [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let buf = "";
  const pending = new Map();
  let nextId = 1;

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  proc.stderr.on("data", () => {
    // Swallow — some SDK versions chatter on stderr. Surface via test failures.
  });

  function sendRaw(obj) {
    proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      sendRaw({ jsonrpc: "2.0", id, method, params });
    });
  }

  function notify(method, params) {
    sendRaw({ jsonrpc: "2.0", method, params });
  }

  // Handshake.
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "claudecall-test", version: "0.0.0" },
  });
  notify("notifications/initialized");

  return {
    async listTools() {
      const resp = await request("tools/list");
      return resp.result?.tools ?? [];
    },
    async callTool(name, args = {}) {
      const resp = await request("tools/call", { name, arguments: args });
      return resp.result;
    },
    async callToolText(name, args = {}) {
      const result = await this.callTool(name, args);
      return result?.content?.[0]?.text;
    },
    async callToolJson(name, args = {}) {
      const text = await this.callToolText(name, args);
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    isError(result) {
      return result?.isError === true;
    },
    async close() {
      try {
        proc.stdin.end();
      } catch {
        // Ignore.
      }
      await new Promise((resolve) => {
        if (proc.exitCode != null) return resolve();
        proc.once("close", resolve);
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // Ignore.
          }
          resolve();
        }, 1500);
      });
    },
  };
}
