import { z } from "zod";

import {
  appendPending,
  loadPending,
  resolvePending,
  appendHistory,
} from "../../skill/scripts/store.mjs";
import { loadConfig } from "../shared/config.mjs";
import { jsonReply, errorReply } from "../shared/reply.mjs";
import {
  createAuthedClient,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  findFreeSlot,
  CalendarError,
} from "./helpers.mjs";

export function registerCalendarTools(server) {
  function getCal() {
    const config = loadConfig();
    return createAuthedClient(config);
  }

  server.tool(
    "calendar_list_events",
    "List calendar events in a time range. Use this to find upcoming meetings, check for conflicts, or locate a specific event by title.",
    {
      time_min: z
        .string()
        .optional()
        .describe("ISO datetime; defaults to now"),
      time_max: z
        .string()
        .optional()
        .describe("ISO datetime; defaults to 7 days from now"),
      query: z
        .string()
        .optional()
        .describe("Free-text search across title, description, attendees"),
      calendar_id: z.string().optional().default("primary"),
      max_results: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ time_min, time_max, query, calendar_id, max_results }) => {
      try {
        const cal = getCal();
        const events = await listEvents(cal, {
          timeMin: time_min,
          timeMax:
            time_max ||
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          calendarId: calendar_id,
          maxResults: max_results,
          query,
        });
        return jsonReply({ count: events.length, events });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  server.tool(
    "calendar_get_event",
    "Fetch full details of a specific event by ID.",
    {
      event_id: z.string(),
      calendar_id: z.string().optional().default("primary"),
    },
    async ({ event_id, calendar_id }) => {
      try {
        const cal = getCal();
        const event = await getEvent(cal, event_id, { calendarId: calendar_id });
        return jsonReply(event);
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );

  // --- Approval-gated create ---

  server.tool(
    "calendar_create_preview",
    "Create a pending calendar event draft. Returns pending_id and a preview of what would be created. Wait for user approval before calling calendar_create_confirm.",
    {
      title: z.string().min(1),
      start: z
        .string()
        .describe("ISO datetime (2026-04-15T15:00:00) or YYYY-MM-DD for all-day"),
      end: z.string(),
      start_date_only: z.boolean().optional().default(false),
      timezone: z.string().optional().describe("e.g. America/New_York"),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z
        .array(z.string().email())
        .optional()
        .describe("Email addresses to invite"),
      calendar_id: z.string().optional().default("primary"),
    },
    async (payload) => {
      const row = appendPending({
        channel: "calendar",
        action: "create",
        payload,
      });
      const preview = [
        "Event: " + payload.title,
        "When:  " + payload.start + " → " + payload.end,
        payload.location ? "Where: " + payload.location : null,
        payload.attendees?.length
          ? "Invite: " + payload.attendees.join(", ")
          : null,
        payload.description ? "\n" + payload.description : null,
      ]
        .filter((x) => x !== null)
        .join("\n");
      return jsonReply({
        pending_id: row.id,
        preview,
        instructions:
          "Show this preview to the user. Wait for explicit 'ok'/'create'/'yes' before calling calendar_create_confirm.",
      });
    }
  );

  server.tool(
    "calendar_create_confirm",
    "Actually create a previously-previewed calendar event. Only call after explicit user approval.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply(
          "Pending row is already " + pending.status + " and cannot be used."
        );
      }
      if (pending.channel !== "calendar") {
        return errorReply("Pending row is not a calendar action.");
      }

      try {
        const cal = getCal();
        const event = await createEvent(cal, pending.payload, {
          calendarId: pending.payload.calendar_id,
        });
        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "calendar",
          contact: (pending.payload.attendees || []).join(",") || "(self)",
          direction: "outbound",
          summary: "Event created: " + pending.payload.title,
          content: JSON.stringify(event),
          status: "sent",
          provider_event_id: event.id,
        });
        return jsonReply({ ok: true, event });
      } catch (err) {
        appendHistory({
          channel: "calendar",
          contact: (pending.payload.attendees || []).join(",") || "(self)",
          direction: "outbound",
          summary: "Event create attempt: " + pending.payload.title,
          status: "failed",
          error: err.message,
        });
        if (err instanceof CalendarError) return errorReply(err.message);
        return errorReply("Calendar create failed: " + err.message);
      }
    }
  );

  // --- Approval-gated update ---

  server.tool(
    "calendar_update_preview",
    "Create a pending update to an existing calendar event. Returns pending_id and a preview of the changes.",
    {
      event_id: z.string(),
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      start_date_only: z.boolean().optional(),
      timezone: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(z.string().email()).optional(),
      calendar_id: z.string().optional().default("primary"),
    },
    async (payload) => {
      const row = appendPending({
        channel: "calendar",
        action: "update",
        payload,
      });
      const preview = [
        "Update event: " + payload.event_id,
        payload.title ? "New title: " + payload.title : null,
        payload.start ? "New start: " + payload.start : null,
        payload.end ? "New end: " + payload.end : null,
        payload.location ? "New location: " + payload.location : null,
        payload.attendees ? "Attendees: " + payload.attendees.join(", ") : null,
      ]
        .filter((x) => x !== null)
        .join("\n");
      return jsonReply({
        pending_id: row.id,
        preview,
        instructions:
          "Show this preview to the user. Wait for explicit approval before calling calendar_update_confirm.",
      });
    }
  );

  server.tool(
    "calendar_update_confirm",
    "Apply a previously-previewed calendar event update.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply("Pending row is already " + pending.status);
      }
      if (pending.channel !== "calendar") {
        return errorReply("Pending row is not a calendar action.");
      }
      try {
        const cal = getCal();
        const { event_id, calendar_id, ...changes } = pending.payload;
        const event = await updateEvent(cal, event_id, changes, {
          calendarId: calendar_id,
        });
        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "calendar",
          contact: (changes.attendees || []).join(",") || "(self)",
          direction: "outbound",
          summary: "Event updated: " + (changes.title || event_id),
          content: JSON.stringify(event),
          status: "sent",
          provider_event_id: event.id,
        });
        return jsonReply({ ok: true, event });
      } catch (err) {
        if (err instanceof CalendarError) return errorReply(err.message);
        return errorReply("Calendar update failed: " + err.message);
      }
    }
  );

  // --- Approval-gated delete ---

  server.tool(
    "calendar_delete_preview",
    "Create a pending delete for a calendar event. Returns pending_id; wait for approval before calling calendar_delete_confirm.",
    {
      event_id: z.string(),
      calendar_id: z.string().optional().default("primary"),
    },
    async (payload) => {
      const row = appendPending({
        channel: "calendar",
        action: "delete",
        payload,
      });
      return jsonReply({
        pending_id: row.id,
        preview: "Delete event: " + payload.event_id,
        instructions:
          "Show this to the user. Wait for explicit 'ok'/'delete'/'yes' before calling calendar_delete_confirm.",
      });
    }
  );

  server.tool(
    "calendar_delete_confirm",
    "Delete a previously-previewed calendar event. Sends cancellation emails to attendees.",
    { pending_id: z.string() },
    async ({ pending_id }) => {
      const pending = loadPending().entries.find((e) => e.id === pending_id);
      if (!pending) return errorReply("No pending row with id " + pending_id);
      if (pending.status !== "pending") {
        return errorReply("Pending row is already " + pending.status);
      }
      if (pending.channel !== "calendar") {
        return errorReply("Pending row is not a calendar action.");
      }
      try {
        const cal = getCal();
        await deleteEvent(cal, pending.payload.event_id, {
          calendarId: pending.payload.calendar_id,
        });
        resolvePending(pending_id, "approved");
        appendHistory({
          channel: "calendar",
          contact: "(self)",
          direction: "outbound",
          summary: "Event deleted: " + pending.payload.event_id,
          status: "sent",
          provider_event_id: pending.payload.event_id,
        });
        return jsonReply({ ok: true, deleted: pending.payload.event_id });
      } catch (err) {
        if (err instanceof CalendarError) return errorReply(err.message);
        return errorReply("Calendar delete failed: " + err.message);
      }
    }
  );

  server.tool(
    "calendar_find_slot",
    "Find free time slots of a given duration between two datetimes, respecting working hours. Use this to propose meeting times.",
    {
      duration_minutes: z.number().int().min(5).max(480).default(30),
      time_min: z.string().describe("ISO datetime start of search window"),
      time_max: z.string().describe("ISO datetime end of search window"),
      work_hour_start: z.number().int().min(0).max(23).default(9),
      work_hour_end: z.number().int().min(1).max(24).default(18),
      timezone: z.string().optional().default("UTC"),
      max_results: z.number().int().min(1).max(20).default(5),
      calendar_id: z.string().optional().default("primary"),
    },
    async (args) => {
      try {
        const cal = getCal();
        const slots = await findFreeSlot(cal, {
          durationMinutes: args.duration_minutes,
          timeMin: args.time_min,
          timeMax: args.time_max,
          workHourStart: args.work_hour_start,
          workHourEnd: args.work_hour_end,
          timezone: args.timezone,
          maxResults: args.max_results,
          calendarId: args.calendar_id,
        });
        return jsonReply({
          count: slots.length,
          duration_minutes: args.duration_minutes,
          slots,
        });
      } catch (err) {
        return errorReply(err.message);
      }
    }
  );
}
