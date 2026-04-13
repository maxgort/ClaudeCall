import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getVapiCallResult,
  VapiError,
  VAPI_BASE_URL,
} from "../../mcps/voice/helpers.mjs";

function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init });
  };
  fn.calls = calls;
  return fn;
}

function okResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const config = { VAPI_API_KEY: "test-key" };

test("getVapiCallResult GETs /call/:id with Bearer auth", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({ id: "call-123", status: "queued" })
  );
  await getVapiCallResult(config, "call-123", { fetchFn });
  assert.equal(fetchFn.calls.length, 1);
  const { url, init } = fetchFn.calls[0];
  assert.equal(url, VAPI_BASE_URL + "/call/call-123");
  assert.equal(init.method, "GET");
  assert.equal(init.headers.Authorization, "Bearer test-key");
});

test("getVapiCallResult returns ended call with transcript and duration", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({
      id: "call-123",
      status: "ended",
      endedReason: "customer-ended-call",
      startedAt: "2026-04-13T19:00:00Z",
      endedAt: "2026-04-13T19:02:30Z",
      transcript: "Hello, I'd like to book a table for 2 at 7pm...",
      summary: "Reservation confirmed for 2 people at 7pm Friday.",
      recordingUrl: "https://vapi.example.com/rec/abc.mp3",
      cost: 0.15,
    })
  );
  const result = await getVapiCallResult(config, "call-123", { fetchFn });
  assert.equal(result.call_id, "call-123");
  assert.equal(result.status, "ended");
  assert.equal(result.ended_reason, "customer-ended-call");
  assert.equal(result.duration_seconds, 150);
  assert.match(result.transcript, /book a table/);
  assert.match(result.summary, /Reservation confirmed/);
  assert.equal(result.recording_url, "https://vapi.example.com/rec/abc.mp3");
  assert.equal(result.cost_usd, 0.15);
});

test("getVapiCallResult handles still-running call gracefully", async () => {
  const fetchFn = mockFetch(() =>
    okResponse({ id: "call-123", status: "in-progress" })
  );
  const result = await getVapiCallResult(config, "call-123", { fetchFn });
  assert.equal(result.status, "in-progress");
  assert.equal(result.transcript, null);
  assert.equal(result.duration_seconds, null);
});

test("getVapiCallResult throws VapiError on 404", async () => {
  const fetchFn = mockFetch(() =>
    errorResponse(404, { message: "call not found" })
  );
  await assert.rejects(
    () => getVapiCallResult(config, "nope", { fetchFn }),
    (err) => {
      assert.ok(err instanceof VapiError);
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test("getVapiCallResult wraps network errors", async () => {
  const fetchFn = async () => {
    throw new Error("ETIMEDOUT");
  };
  await assert.rejects(
    () => getVapiCallResult(config, "call-123", { fetchFn }),
    (err) => {
      assert.ok(err instanceof VapiError);
      assert.match(err.message, /network error/);
      return true;
    }
  );
});
