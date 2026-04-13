import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = join(
  __dirname,
  "..",
  "..",
  "skill",
  "scenarios"
);

// Whitelist for scenario names. Prevents path traversal via prompt injection.
export const SCENARIO_NAME_RE = /^[a-z0-9_]+$/;

export function isValidScenarioName(name) {
  return typeof name === "string" && SCENARIO_NAME_RE.test(name);
}

export function listScenarios(dir = SCENARIOS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const body = readFileSync(join(dir, f), "utf8");
      const firstLine = body.split("\n").find((l) => l.trim()) || f;
      const summary = firstLine.replace(/^#+\s*/, "").trim();
      return { name: f.replace(/\.md$/, ""), summary };
    });
}

export function loadScenarioBody(name, dir = SCENARIOS_DIR) {
  if (!isValidScenarioName(name)) return null;
  const path = join(dir, name + ".md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function substituteVariables(text, vars) {
  if (!text) return "";
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    vars && vars[key] != null ? String(vars[key]) : "{{" + key + "}}"
  );
}

export const VAPI_BASE_URL = "https://api.vapi.ai";

export function buildVapiRequestBody(config, payload, script) {
  return {
    phoneNumberId: config.VAPI_PHONE_NUMBER_ID,
    assistantId: config.VAPI_ASSISTANT_ID,
    customer: { number: payload.to_number },
    assistantOverrides: {
      firstMessage: payload.caller_name
        ? `Hi, this is ${payload.caller_name}.`
        : undefined,
      variableValues: {
        ...(payload.variables || {}),
        callback_number: payload.callback_number || "",
        script,
      },
    },
  };
}

export class VapiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = "VapiError";
    this.status = status;
    this.data = data;
  }
}

// Places a Vapi call. fetchFn is injectable for tests. Throws VapiError on
// non-2xx or network failure; returns { call_id, status } on success.
export async function createVapiCall(
  config,
  payload,
  scenarioBody,
  { fetchFn = fetch, baseUrl = VAPI_BASE_URL } = {}
) {
  const script = substituteVariables(
    scenarioBody || payload.freeform_prompt || "",
    payload.variables
  );
  const body = buildVapiRequestBody(config, payload, script);

  let resp;
  try {
    resp = await fetchFn(baseUrl + "/call", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.VAPI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new VapiError("network error: " + err.message);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok) {
    throw new VapiError(
      "Vapi call failed (" + resp.status + "): " + JSON.stringify(data),
      { status: resp.status, data }
    );
  }

  return { call_id: data.id, status: data.status, script };
}

export function formatVoicePreview(p, scenarioBody) {
  return [
    "Call to:    " + p.to_number,
    "Scenario:   " + (p.scenario || "ad-hoc"),
    "Caller as:  " + (p.caller_name || "(default)"),
    "Callback:   " + (p.callback_number || "-"),
    "",
    "Variables:",
    JSON.stringify(p.variables || {}, null, 2),
    "",
    "Script:",
    scenarioBody
      ? scenarioBody.slice(0, 1200) +
        (scenarioBody.length > 1200 ? "\n... (truncated)" : "")
      : "(free-form, no scenario script)",
  ].join("\n");
}
