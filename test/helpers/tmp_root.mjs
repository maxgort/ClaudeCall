import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Creates an isolated CLAUDECALL_ROOT under the OS temp dir, pre-populated
// with empty store files. Returns { root, cleanup }.
//
// Usage:
//   const { root, cleanup } = makeTmpRoot();
//   process.env.CLAUDECALL_ROOT = root;
//   try { ... } finally { cleanup(); }
export function makeTmpRoot({ profile = null, configEnv = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ccall-test-"));
  writeFileSync(
    join(root, "history.json"),
    JSON.stringify({ entries: [] }, null, 2)
  );
  writeFileSync(
    join(root, "pending.json"),
    JSON.stringify({ entries: [] }, null, 2)
  );
  if (profile) {
    writeFileSync(
      join(root, "profile.json"),
      typeof profile === "string" ? profile : JSON.stringify(profile, null, 2)
    );
  }
  if (configEnv) {
    writeFileSync(join(root, "config.env"), configEnv);
  }

  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore — tmpdir cleanup is best effort.
    }
  };

  return { root, cleanup };
}

// Wraps a test body so CLAUDECALL_ROOT is set to a fresh temp dir for the
// duration and restored afterwards.
export async function withTmpRoot(opts, fn) {
  if (typeof opts === "function") {
    fn = opts;
    opts = {};
  }
  const { root, cleanup } = makeTmpRoot(opts);
  const prev = process.env.CLAUDECALL_ROOT;
  process.env.CLAUDECALL_ROOT = root;
  try {
    return await fn(root);
  } finally {
    if (prev === undefined) delete process.env.CLAUDECALL_ROOT;
    else process.env.CLAUDECALL_ROOT = prev;
    cleanup();
  }
}
