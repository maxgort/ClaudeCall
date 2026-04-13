#!/usr/bin/env node
// Core MCP server — cross-channel infra: profile, history, pending list.

// Route all non-error console output to stderr so stray prints never break
// the MCP stdio protocol.
console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.info = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.warn = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
console.debug = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCoreTools } from "./register.mjs";

const server = new McpServer({
  name: "claudecall-core",
  version: "0.1.0",
});

registerCoreTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
