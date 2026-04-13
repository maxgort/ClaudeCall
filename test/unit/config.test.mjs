import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { withTmpRoot } from "../helpers/tmp_root.mjs";
import { loadConfig, requireKeys } from "../../mcps/shared/config.mjs";

test("loadConfig returns {} when file is missing", () =>
  withTmpRoot(async () => {
    // No config.env written — should return empty object, not throw
    const cfg = loadConfig();
    assert.deepEqual(cfg, {});
  }));

test("loadConfig parses plain key=value lines", () =>
  withTmpRoot({ configEnv: "FOO=bar\nBAZ=qux\n" }, async () => {
    const cfg = loadConfig();
    assert.equal(cfg.FOO, "bar");
    assert.equal(cfg.BAZ, "qux");
  }));

test("loadConfig strips double and single quotes", () =>
  withTmpRoot(
    { configEnv: 'NAME="Alex Rivers"\nSIG=\'— Alex\'\n' },
    async () => {
      const cfg = loadConfig();
      assert.equal(cfg.NAME, "Alex Rivers");
      assert.equal(cfg.SIG, "— Alex");
    }
  ));

test("loadConfig ignores comments and blank lines", () =>
  withTmpRoot(
    {
      configEnv: "# a comment\n\nFOO=1\n   # indented comment\nBAR=2\n",
    },
    async () => {
      const cfg = loadConfig();
      assert.equal(cfg.FOO, "1");
      assert.equal(cfg.BAR, "2");
      assert.equal(Object.keys(cfg).length, 2);
    }
  ));

test("loadConfig handles CRLF line endings", () =>
  withTmpRoot({ configEnv: "FOO=bar\r\nBAZ=qux\r\n" }, async () => {
    const cfg = loadConfig();
    assert.equal(cfg.FOO, "bar");
    assert.equal(cfg.BAZ, "qux");
  }));

test("loadConfig preserves '=' inside values", () =>
  withTmpRoot({ configEnv: "TOKEN=abc=def=ghi\n" }, async () => {
    const cfg = loadConfig();
    assert.equal(cfg.TOKEN, "abc=def=ghi");
  }));

test("loadConfig skips lines without '='", () =>
  withTmpRoot({ configEnv: "FOO=bar\njunkline\nBAZ=qux\n" }, async () => {
    const cfg = loadConfig();
    assert.equal(cfg.FOO, "bar");
    assert.equal(cfg.BAZ, "qux");
    assert.equal(cfg.junkline, undefined);
  }));

test("requireKeys throws when keys are missing, naming the channel and keys", () => {
  const cfg = { FOO: "1" };
  assert.throws(
    () => requireKeys(cfg, ["FOO", "BAR", "BAZ"], "voice"),
    (err) => {
      assert.match(err.message, /voice/);
      assert.match(err.message, /BAR/);
      assert.match(err.message, /BAZ/);
      assert.ok(!err.message.includes("FOO"), "should not list present keys");
      return true;
    }
  );
});

test("requireKeys is a no-op when all keys are present", () => {
  const cfg = { FOO: "1", BAR: "2" };
  assert.doesNotThrow(() => requireKeys(cfg, ["FOO", "BAR"], "email"));
});

test("requireKeys treats empty-string values as missing", () => {
  const cfg = { FOO: "" };
  assert.throws(() => requireKeys(cfg, ["FOO"], "email"), /FOO/);
});
