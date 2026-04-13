import { z } from "zod";

import {
  loadProfile,
  queryHistory,
  appendHistory,
  loadPending,
} from "../../skill/scripts/store.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";

export function registerCoreTools(server) {
  server.tool(
    "load_profile",
    "Load the user's style profile from ~/.claudecall/profile.json. Call this at the start of every session before drafting anything.",
    {},
    async () => {
      const profile = loadProfile();
      if (!profile) {
        return errorReply(
          "No profile found at ~/.claudecall/profile.json. " +
            "Ask the user to copy skill/profile.example.json there and edit it."
        );
      }
      return jsonReply(profile);
    }
  );

  server.tool(
    "query_history",
    "Return recent interactions with a contact across all channels. Always call this before drafting a message to a known contact.",
    {
      contact: z
        .string()
        .describe("Email address, phone number, or Telegram handle."),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ contact, limit }) => {
      const entries = queryHistory(contact, limit);
      return jsonReply({ contact, count: entries.length, entries });
    }
  );

  server.tool(
    "log_sent",
    "Log a successfully sent (or failed) outbound action to the cross-channel history. Call this after every send.",
    {
      channel: z.enum(["email", "voice", "telegram"]),
      contact: z.string(),
      direction: z.enum(["outbound", "inbound"]).default("outbound"),
      summary: z.string().describe("One-sentence summary of the action."),
      content: z.string().optional().describe("Full content or transcript."),
      status: z.enum(["sent", "failed"]),
      error: z.string().optional(),
    },
    async (entry) => {
      const row = appendHistory(entry);
      return jsonReply({ ok: true, id: row.id });
    }
  );

  server.tool(
    "list_pending",
    "List all pending (not yet approved) outbound actions. Useful for catching orphaned drafts.",
    {},
    async () => {
      const db = loadPending();
      const open = db.entries.filter((e) => e.status === "pending");
      return jsonReply({ count: open.length, entries: open });
    }
  );
}
