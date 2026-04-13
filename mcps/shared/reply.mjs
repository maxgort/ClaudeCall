// Helpers for formatting MCP tool responses.

export function textReply(text) {
  return { content: [{ type: "text", text }] };
}

export function jsonReply(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

export function errorReply(message) {
  return {
    isError: true,
    content: [{ type: "text", text: "ERROR: " + message }],
  };
}
