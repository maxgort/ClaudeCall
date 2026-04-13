import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  substituteVariables,
  isValidScenarioName,
  listScenarios,
  loadScenarioBody,
  formatVoicePreview,
  SCENARIO_NAME_RE,
} from "../../mcps/voice/helpers.mjs";

test("substituteVariables replaces known placeholders", () => {
  const out = substituteVariables("Hi {{name}}, welcome to {{city}}.", {
    name: "Alex",
    city: "NYC",
  });
  assert.equal(out, "Hi Alex, welcome to NYC.");
});

test("substituteVariables leaves unknown placeholders intact", () => {
  const out = substituteVariables("Hi {{name}}, see you {{day}}.", {
    name: "Alex",
  });
  assert.equal(out, "Hi Alex, see you {{day}}.");
});

test("substituteVariables handles whitespace inside braces", () => {
  const out = substituteVariables("{{  name  }}", { name: "Alex" });
  assert.equal(out, "Alex");
});

test("substituteVariables coerces numeric values to strings", () => {
  const out = substituteVariables("party size {{n}}", { n: 4 });
  assert.equal(out, "party size 4");
});

test("substituteVariables returns empty on empty/null template", () => {
  assert.equal(substituteVariables("", { a: 1 }), "");
  assert.equal(substituteVariables(null, { a: 1 }), "");
  assert.equal(substituteVariables(undefined, { a: 1 }), "");
});

test("substituteVariables with no vars leaves placeholders intact", () => {
  assert.equal(substituteVariables("{{name}}", undefined), "{{name}}");
  assert.equal(substituteVariables("{{name}}", null), "{{name}}");
});

test("isValidScenarioName accepts lowercase, digits, underscores", () => {
  assert.ok(isValidScenarioName("restaurant_booking"));
  assert.ok(isValidScenarioName("confirm_appointment"));
  assert.ok(isValidScenarioName("abc123"));
  assert.ok(isValidScenarioName("a"));
});

test("isValidScenarioName rejects path traversal attempts", () => {
  assert.equal(isValidScenarioName("../README"), false);
  assert.equal(isValidScenarioName("../../etc/passwd"), false);
  assert.equal(isValidScenarioName("restaurant/booking"), false);
  assert.equal(isValidScenarioName("restaurant\\booking"), false);
});

test("isValidScenarioName rejects uppercase, spaces, dots", () => {
  assert.equal(isValidScenarioName("RestaurantBooking"), false);
  assert.equal(isValidScenarioName("restaurant booking"), false);
  assert.equal(isValidScenarioName("restaurant.booking"), false);
  assert.equal(isValidScenarioName(""), false);
  assert.equal(isValidScenarioName(null), false);
  assert.equal(isValidScenarioName(undefined), false);
});

test("loadScenarioBody refuses invalid names even if a matching file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccall-vh-"));
  try {
    writeFileSync(join(dir, "evil.md"), "# ok");
    // Valid name → loads
    assert.ok(loadScenarioBody("evil", dir));
    // Invalid name even if the file technically exists on disk → refuses
    assert.equal(loadScenarioBody("../evil", dir), null);
    assert.equal(loadScenarioBody("EVIL", dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadScenarioBody returns null for missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccall-vh-"));
  try {
    assert.equal(loadScenarioBody("nope", dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listScenarios reads .md files, uses first header line as summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccall-vh-"));
  try {
    writeFileSync(join(dir, "alpha.md"), "# Alpha scenario\n\nBody here.");
    writeFileSync(join(dir, "beta.md"), "## Beta summary\n");
    writeFileSync(join(dir, "notes.txt"), "ignored");
    writeFileSync(join(dir, "README.md"), "# Readme\n");

    const scenarios = listScenarios(dir);
    const byName = Object.fromEntries(scenarios.map((s) => [s.name, s.summary]));
    assert.ok("alpha" in byName);
    assert.ok("beta" in byName);
    assert.ok("README" in byName, "listScenarios is not opinionated about README");
    assert.equal(byName.alpha, "Alpha scenario");
    assert.equal(byName.beta, "Beta summary");
    // non-md files ignored
    assert.equal("notes" in byName, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listScenarios returns [] when dir does not exist", () => {
  assert.deepEqual(listScenarios(join(tmpdir(), "ccall-nonexistent-xyz")), []);
});

test("formatVoicePreview shows ad-hoc when no scenario", () => {
  const out = formatVoicePreview(
    {
      to_number: "+15551234567",
      variables: { foo: "bar" },
    },
    null
  );
  assert.match(out, /Call to:\s+\+15551234567/);
  assert.match(out, /Scenario:\s+ad-hoc/);
  assert.match(out, /free-form, no scenario script/);
});

test("formatVoicePreview truncates long scenario bodies", () => {
  const long = "x".repeat(2000);
  const out = formatVoicePreview(
    { to_number: "+15551234567", scenario: "big" },
    long
  );
  assert.match(out, /\(truncated\)/);
  assert.ok(out.length < 2000 + 500, "truncation kept output bounded");
});

test("SCENARIO_NAME_RE is exported and anchored", () => {
  assert.equal(SCENARIO_NAME_RE.test("valid_name"), true);
  assert.equal(SCENARIO_NAME_RE.test("has space"), false);
  // Anchored test: "ok/bad" must not match
  assert.equal(SCENARIO_NAME_RE.test("ok/bad"), false);
});
