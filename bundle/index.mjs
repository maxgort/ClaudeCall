#!/usr/bin/env node
// ClaudeCall MCPB bundle entry point.
//
// Combines all 4 MCP servers (core, email, voice, telegram) into a single
// MCP server process exposing 17 tools total. Claude Desktop treats this as
// one "extension" with one stdio connection. Config comes from user_config
// via process.env (injected by Claude Desktop from the OS keychain).

// Redirect stray console output to stderr so nothing breaks the stdio
// JSON-RPC protocol.
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.debug = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerCoreTools } from "../mcps/core/register.mjs";
import { registerEmailTools } from "../mcps/email/register.mjs";
import { registerVoiceTools } from "../mcps/voice/register.mjs";
import {
  registerTelegramTools,
  disconnectTelegramClient,
} from "../mcps/telegram/register.mjs";

const server = new McpServer({
  name: "claudecall",
  version: "0.1.0",
});

registerCoreTools(server);
registerEmailTools(server);
registerVoiceTools(server);
registerTelegramTools(server);

process.on("exit", () => disconnectTelegramClient());

const transport = new StdioServerTransport();
await server.connect(transport);
