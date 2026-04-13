#!/usr/bin/env node
// Telegram MCP server — standalone entry point.

console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.debug = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerTelegramTools,
  disconnectTelegramClient,
} from "./register.mjs";

const server = new McpServer({
  name: "claudecall-telegram",
  version: "0.2.0",
});

registerTelegramTools(server);

process.on("exit", () => disconnectTelegramClient());

const transport = new StdioServerTransport();
await server.connect(transport);
