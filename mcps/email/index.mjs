#!/usr/bin/env node
// Email MCP server — standalone entry point.

console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.debug = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerEmailTools } from "./register.mjs";

const server = new McpServer({
  name: "claudecall-email",
  version: "0.1.0",
});

registerEmailTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
