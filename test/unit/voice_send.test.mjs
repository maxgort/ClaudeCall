import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createVapiCall,
  VapiError,
  buildVapiRequestBody,
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

const config = {
  VAPI_API_KEY: "test-key",
  VAPI_PHONE_NUMBER_ID: "phone-1",
  VAPI_ASSISTANT_ID: "assistant-1",
};

test("createVapiCall hits /call with Bearer auth", async () => {
  const fetchFn = mockFetch(() => okResponse({ id: "call-123", status: "queued" }));
  const result = await createVapiCall(
    config,
    { to_number: "+15551234567", scenario: "restaurant_booking" },
    "Book a table for {{party_size}}.",
    { fetchFn }
  );

  assert.equal(fetchFn.calls.length, 1);
  const { url, init } = fetchFn.calls[0];
  assert.equal(url, VAPI_BASE_URL + "/call");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer test-key");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(result.call_id, "call-123");
  assert.equal(result.status, "queued");
});

test("createVapiCall body shape matches Vapi contract", async () => {
  const fetchFn = mockFetch(() => okResponse({ id: "x", status: "queued" }));
  await createVapiCall(
    config,
    {
      to_number: "+15551234567",
      caller_name: "Alex",
      callback_number: "+15550100",
      variables: { restaurant_name: "Osteria", party_size: 4 },
    },
    "Call {{restaurant_name}} for {{party_size}}.",
    { fetchFn }
  );
  const sent = JSON.parse(fetchFn.calls[0].init.body);
  assert.equal(sent.phoneNumberId, "phone-1");
  assert.equal(sent.assistantId, "assistant-1");
  assert.equal(sent.customer.number, "+15551234567");
  assert.equal(
    sent.assistantOverrides.firstMessage,
    "Hi, this is Alex."
  );
  assert.equal(
    sent.assistantOverrides.variableValues.callback_number,
    "+15550100"
  );
  // Variable substitution must have happened BEFORE the call
  assert.equal(
    sent.assistantOverrides.variableValues.script,
    "Call Osteria for 4."
  );
});

test("createVapiCall substitutes variables from scenario body", async () => {
  const fetchFn = mockFetch(() => okResponse({ id: "x", status: "queued" }));
  await createVapiCall(
    config,
    {
      to_number: "+15551234567",
      variables: { name: "Alex" },
    },
    "Hello {{name}}, this is a test. Unknown: {{missing}}.",
    { fetchFn }
  );
  const sent = JSON.parse(fetchFn.calls[0].init.body);
  const script = sent.assistantOverrides.variableValues.script;
  assert.equal(
    script,
    "Hello Alex, this is a test. Unknown: {{missing}}."
  );
});

test("createVapiCall falls back to freeform_prompt when no scenario", async () => {
  const fetchFn = mockFetch(() => okResponse({ id: "x", status: "queued" }));
  await createVapiCall(
    config,
    {
      to_number: "+15551234567",
      freeform_prompt: "Just say hello.",
    },
    null,
    { fetchFn }
  );
  const sent = JSON.parse(fetchFn.calls[0].init.body);
  assert.equal(sent.assistantOverrides.variableValues.script, "Just say hello.");
});

test("createVapiCall throws VapiError on 4xx", async () => {
  const fetchFn = mockFetch(() =>
    errorResponse(400, { message: "bad phone number" })
  );
  await assert.rejects(
    () =>
      createVapiCall(
        config,
        { to_number: "+15551234567", freeform_prompt: "x" },
        null,
        { fetchFn }
      ),
    (err) => {
      assert.ok(err instanceof VapiError);
      assert.equal(err.status, 400);
      assert.match(err.message, /400/);
      assert.match(err.message, /bad phone number/);
      return true;
    }
  );
});

test("createVapiCall wraps network errors as VapiError", async () => {
  const fetchFn = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () =>
      createVapiCall(
        config,
        { to_number: "+15551234567", freeform_prompt: "x" },
        null,
        { fetchFn }
      ),
    (err) => {
      assert.ok(err instanceof VapiError);
      assert.match(err.message, /network error/);
      assert.match(err.message, /ECONNREFUSED/);
      return true;
    }
  );
});

test("buildVapiRequestBody omits firstMessage when no caller_name", () => {
  const body = buildVapiRequestBody(
    config,
    { to_number: "+1", variables: {} },
    "script"
  );
  assert.equal(body.assistantOverrides.firstMessage, undefined);
});
