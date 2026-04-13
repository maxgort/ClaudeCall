#!/usr/bin/env node
// Voice MCP server — standalone entry point.

console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.debug = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerVoiceTools } from "./register.mjs";

const server = new McpServer({
  name: "claudecall-voice",
  version: "0.1.0",
});

registerVoiceTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
