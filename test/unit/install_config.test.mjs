import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  run,
  claudeConfigPath,
  buildServerEntries,
} from "../../skill/scripts/install_config.mjs";

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), "ccall-installcfg-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function silentLogger() {
  return { log: () => {}, warn: () => {} };
}

test("run() creates config file with 4 mcpServers entries in empty dir", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");
    const result = run({
      configPath,
      repoRoot: "/repo/claudecall",
      nodeBin: "/usr/bin/node",
      logger: silentLogger(),
    });

    assert.ok(existsSync(configPath));
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const names = Object.keys(cfg.mcpServers).sort();
    assert.deepEqual(names, [
      "claudecall-calendar",
      "claudecall-core",
      "claudecall-email",
      "claudecall-slack",
      "claudecall-telegram",
      "claudecall-voice",
    ]);
    assert.equal(cfg.mcpServers["claudecall-core"].command, "/usr/bin/node");
    assert.equal(result.backupPath, null, "no backup when no existing file");
    assert.deepEqual(result.servers.sort(), [
      "claudecall-calendar",
      "claudecall-core",
      "claudecall-email",
      "claudecall-slack",
      "claudecall-telegram",
      "claudecall-voice",
    ]);
  } finally {
    cleanup();
  }
});

test("run() merges into existing mcpServers without clobbering unrelated entries", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            "some-other-server": {
              command: "python",
              args: ["/path/to/other.py"],
            },
          },
        },
        null,
        2
      )
    );

    run({
      configPath,
      repoRoot: "/repo/claudecall",
      nodeBin: "/usr/bin/node",
      logger: silentLogger(),
    });

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.theme, "dark", "unrelated top-level keys preserved");
    assert.ok(
      cfg.mcpServers["some-other-server"],
      "unrelated mcpServers entry preserved"
    );
    assert.equal(cfg.mcpServers["some-other-server"].command, "python");
    assert.ok(cfg.mcpServers["claudecall-core"]);
    assert.equal(Object.keys(cfg.mcpServers).length, 7);
  } finally {
    cleanup();
  }
});

test("run() overwrites stale claudecall-* entries (idempotent, no duplicates)", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");

    run({
      configPath,
      repoRoot: "/old/path",
      nodeBin: "/old/node",
      logger: silentLogger(),
    });

    run({
      configPath,
      repoRoot: "/new/path",
      nodeBin: "/new/node",
      logger: silentLogger(),
    });

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(Object.keys(cfg.mcpServers).length, 6);
    assert.equal(cfg.mcpServers["claudecall-core"].command, "/new/node");
    const arg = cfg.mcpServers["claudecall-core"].args[0].replace(/\\/g, "/");
    assert.match(arg, /new\/path\/mcps/);
  } finally {
    cleanup();
  }
});

test("run() creates a timestamped backup on top of an existing file", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));

    const result = run({
      configPath,
      repoRoot: "/repo",
      nodeBin: "/node",
      logger: silentLogger(),
    });

    assert.ok(result.backupPath, "backup path returned");
    assert.match(result.backupPath, /\.claudecall-backup\.\d+$/);
    assert.ok(existsSync(result.backupPath), "backup file exists");

    const files = readdirSync(dir);
    const backups = files.filter((f) => f.includes("claudecall-backup"));
    assert.equal(backups.length, 1);
  } finally {
    cleanup();
  }
});

test("run() handles corrupt existing JSON: backs up and starts fresh", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");
    writeFileSync(configPath, "{ this is not: valid JSON");

    const warnings = [];
    const logger = {
      log: () => {},
      warn: (msg) => warnings.push(msg),
    };

    const result = run({
      configPath,
      repoRoot: "/repo",
      nodeBin: "/node",
      logger,
    });

    assert.ok(result.backupPath);
    assert.ok(existsSync(result.backupPath));
    assert.ok(
      warnings.some((w) => /not valid JSON/.test(w)),
      "warned about corrupt JSON"
    );

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(Object.keys(cfg.mcpServers).length, 6);
  } finally {
    cleanup();
  }
});

test("run() creates parent directory if missing", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "nested", "deep", "claude_desktop_config.json");
    run({
      configPath,
      repoRoot: "/repo",
      nodeBin: "/node",
      logger: silentLogger(),
    });
    assert.ok(existsSync(configPath));
  } finally {
    cleanup();
  }
});

test("run() throws when required args missing", () => {
  assert.throws(() => run({}), /configPath/);
  assert.throws(
    () => run({ configPath: "/tmp/x.json" }),
    /repoRoot/
  );
});

test("run() preserves a config that has no mcpServers key at all", () => {
  const { dir, cleanup } = makeTmp();
  try {
    const configPath = join(dir, "claude_desktop_config.json");
    writeFileSync(configPath, JSON.stringify({ someOtherKey: 1 }));

    run({
      configPath,
      repoRoot: "/repo",
      nodeBin: "/node",
      logger: silentLogger(),
    });

    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(cfg.someOtherKey, 1);
    assert.equal(Object.keys(cfg.mcpServers).length, 6);
  } finally {
    cleanup();
  }
});

// Normalize path separators for cross-platform assertions.
const slashy = (p) => p.replace(/\\/g, "/");

test("claudeConfigPath picks the right path per platform", () => {
  const mac = slashy(claudeConfigPath("darwin"));
  assert.match(
    mac,
    /\/Library\/Application Support\/Claude\/claude_desktop_config\.json$/
  );

  const win = slashy(
    claudeConfigPath("win32", { APPDATA: "C:/Users/alex/AppData/Roaming" })
  );
  assert.ok(
    win.endsWith("/Claude/claude_desktop_config.json"),
    "win32 path ends correctly: " + win
  );

  const linux = slashy(claudeConfigPath("linux"));
  assert.match(linux, /\/\.config\/Claude\/claude_desktop_config\.json$/);
});

test("buildServerEntries uses absolute paths for every MCP", () => {
  const entries = buildServerEntries("/repo/claudecall", "/usr/bin/node");
  for (const name of [
    "claudecall-core",
    "claudecall-email",
    "claudecall-voice",
    "claudecall-telegram",
    "claudecall-slack",
    "claudecall-calendar",
  ]) {
    assert.ok(entries[name], "has " + name);
    assert.equal(entries[name].command, "/usr/bin/node");
    assert.equal(entries[name].args.length, 1);
    const arg = slashy(entries[name].args[0]);
    assert.match(arg, /repo\/claudecall\/mcps\//);
    assert.ok(arg.endsWith("/index.mjs"));
  }
});
