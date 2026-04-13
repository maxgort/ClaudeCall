// Google Calendar MCP helpers — uses googleapis with OAuth2.
//
// The user goes through one-time login via scripts/calendar_login.mjs which
// saves a refresh token to GOOGLE_CALENDAR_REFRESH_TOKEN. Every tool call
// creates an OAuth2Client from the stored credentials, refreshes the access
// token as needed, and makes API calls.

import { google } from "googleapis";

export class CalendarError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "CalendarError";
    if (cause) this.cause = cause;
  }
}

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function createOAuth2Client(config, redirectUri = "http://localhost:0") {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new CalendarError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing. Create a Desktop app OAuth client at https://console.cloud.google.com/apis/credentials."
    );
  }
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function createAuthedClient(config) {
  if (!config.GOOGLE_CALENDAR_REFRESH_TOKEN) {
    throw new CalendarError(
      "GOOGLE_CALENDAR_REFRESH_TOKEN missing. Run: node scripts/calendar_login.mjs"
    );
  }
  const client = createOAuth2Client(config);
  client.setCredentials({
    refresh_token: config.GOOGLE_CALENDAR_REFRESH_TOKEN,
  });
  return google.calendar({ version: "v3", auth: client });
}

function normalizeTime(t) {
  if (!t) return null;
  if (t.dateTime) return t.dateTime;
  if (t.date) return t.date;
  return null;
}

function eventToSummary(ev) {
  return {
    id: ev.id,
    summary: ev.summary || "(no title)",
    description: ev.description || null,
    location: ev.location || null,
    start: normalizeTime(ev.start),
    end: normalizeTime(ev.end),
    attendees: (ev.attendees || []).map((a) => ({
      email: a.email,
      name: a.displayName || null,
      response: a.responseStatus || null,
      organizer: !!a.organizer,
    })),
    organizer: ev.organizer?.email || null,
    status: ev.status || null,
    htmlLink: ev.htmlLink || null,
    recurring: !!ev.recurringEventId,
    updated: ev.updated || null,
  };
}

// Lists events in a time range on a given calendar (default: primary).
export async function listEvents(
  cal,
  { timeMin, timeMax, calendarId = "primary", maxResults = 20, query = "" } = {}
) {
  try {
    const res = await cal.events.list({
      calendarId,
      timeMin: timeMin || new Date().toISOString(),
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
      q: query || undefined,
    });
    return (res.data.items || []).map(eventToSummary);
  } catch (err) {
    throw new CalendarError("listEvents failed: " + err.message, { cause: err });
  }
}

export async function getEvent(cal, eventId, { calendarId = "primary" } = {}) {
  try {
    const res = await cal.events.get({ calendarId, eventId });
    return eventToSummary(res.data);
  } catch (err) {
    throw new CalendarError("getEvent failed: " + err.message, { cause: err });
  }
}

export async function createEvent(
  cal,
  payload,
  { calendarId = "primary", sendUpdates = "all" } = {}
) {
  try {
    const res = await cal.events.insert({
      calendarId,
      sendUpdates,
      requestBody: {
        summary: payload.title,
        description: payload.description,
        location: payload.location,
        start: payload.start_date_only
          ? { date: payload.start }
          : { dateTime: payload.start, timeZone: payload.timezone },
        end: payload.start_date_only
          ? { date: payload.end }
          : { dateTime: payload.end, timeZone: payload.timezone },
        attendees: (payload.attendees || []).map((email) => ({ email })),
      },
    });
    return eventToSummary(res.data);
  } catch (err) {
    throw new CalendarError("createEvent failed: " + err.message, {
      cause: err,
    });
  }
}

export async function updateEvent(
  cal,
  eventId,
  changes,
  { calendarId = "primary", sendUpdates = "all" } = {}
) {
  try {
    // Fetch, merge, update (so partial updates preserve unrelated fields).
    const current = await cal.events.get({ calendarId, eventId });
    const merged = { ...current.data };
    if (changes.title != null) merged.summary = changes.title;
    if (changes.description != null) merged.description = changes.description;
    if (changes.location != null) merged.location = changes.location;
    if (changes.start) {
      merged.start = changes.start_date_only
        ? { date: changes.start }
        : { dateTime: changes.start, timeZone: changes.timezone };
    }
    if (changes.end) {
      merged.end = changes.start_date_only
        ? { date: changes.end }
        : { dateTime: changes.end, timeZone: changes.timezone };
    }
    if (Array.isArray(changes.attendees)) {
      merged.attendees = changes.attendees.map((email) => ({ email }));
    }
    const res = await cal.events.update({
      calendarId,
      eventId,
      sendUpdates,
      requestBody: merged,
    });
    return eventToSummary(res.data);
  } catch (err) {
    throw new CalendarError("updateEvent failed: " + err.message, {
      cause: err,
    });
  }
}

export async function deleteEvent(
  cal,
  eventId,
  { calendarId = "primary", sendUpdates = "all" } = {}
) {
  try {
    await cal.events.delete({ calendarId, eventId, sendUpdates });
    return { ok: true, deleted: eventId };
  } catch (err) {
    throw new CalendarError("deleteEvent failed: " + err.message, {
      cause: err,
    });
  }
}

// Finds free slots of duration minutes between timeMin and timeMax, within
// allowed hours [dayStart, dayEnd] in the user's working-day sense.
export async function findFreeSlot(
  cal,
  {
    durationMinutes = 30,
    timeMin,
    timeMax,
    workHourStart = 9,
    workHourEnd = 18,
    calendarId = "primary",
    timezone = "UTC",
    maxResults = 5,
  } = {}
) {
  try {
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: timezone,
        items: [{ id: calendarId }],
      },
    });
    const busy = fb.data.calendars?.[calendarId]?.busy || [];

    const slots = [];
    const cursor = new Date(timeMin);
    const end = new Date(timeMax);
    const durMs = durationMinutes * 60 * 1000;

    while (cursor.getTime() + durMs <= end.getTime() && slots.length < maxResults) {
      const hour = cursor.getUTCHours();
      // Respect work hours (naive — uses UTC, rely on caller passing TZ-adjusted bounds)
      if (hour < workHourStart || hour + durationMinutes / 60 > workHourEnd) {
        cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
        continue;
      }
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + durMs);
      const conflict = busy.some((b) => {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        return slotStart < bEnd && slotEnd > bStart;
      });
      if (!conflict) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
        cursor.setTime(slotEnd.getTime());
      } else {
        cursor.setTime(cursor.getTime() + 15 * 60 * 1000);
      }
    }
    return slots;
  } catch (err) {
    throw new CalendarError("findFreeSlot failed: " + err.message, {
      cause: err,
    });
  }
}
