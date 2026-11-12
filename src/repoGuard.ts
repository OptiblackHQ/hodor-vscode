// Which files the AI may read or change: only inside the open project, never
// private files (.env, keys), dependency/build folders or anything .gitignore
// hides. Paths come from the model, so every one goes through resolve().

import ignore from "ignore";
import * as path from "path";

export const SKIPPED_DIRS = [
  "node_modules", ".git", "dist", "build", "out", ".next", "vendor", ".venv", "venv", "__pycache__", "coverage", "target",
];

const PRIVATE_FILES = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^\.(npmrc|netrc|pypirc)$/i,
];

export type Resolved = { ok: true; abs: string; rel: string } | { ok: false; reason: string };

export const createGuard = (root: string, gitignoreText: string, realpath: (p: string) => string) => {
  const rules = ignore().add(gitignoreText);
  const safeRealpath = (p: string) => {
    try {
      return realpath(p);
    } catch {
      return p; // a file that doesn't exist yet (create_file)
    }
  };
  const realRoot = safeRealpath(root);
  const outside = (rel: string) => rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

  return {
    resolve(input: string): Resolved {
      if (input.includes("\0")) return { ok: false, reason: "invalid path" };
      const abs = path.resolve(root, input || ".");
      const rel = path.relative(root, abs);
      if (outside(rel)) return { ok: false, reason: "outside the project" };
      if (outside(path.relative(realRoot, safeRealpath(abs)))) return { ok: false, reason: "outside the project (link)" };
      const posix = rel.split(path.sep).join("/");
      if (!posix) return { ok: true, abs, rel: "" };
      const parts = posix.split("/");
      const skipped = parts.find((p) => SKIPPED_DIRS.includes(p));
      if (skipped) return { ok: false, reason: `skipped folder (${skipped})` };
      const name = parts[parts.length - 1];
      if (PRIVATE_FILES.some((re) => re.test(name))) return { ok: false, reason: `private file (${name})` };
      if (rules.ignores(posix) || rules.ignores(`${posix}/`)) return { ok: false, reason: "ignored by .gitignore" };
      return { ok: true, abs, rel: posix };
    },
  };
};

export type Guard = ReturnType<typeof createGuard>;

/** Lines containing `query` (case-insensitive, literal), trimmed to 200 characters. */
export const matchLines = (text: string, query: string, max: number): { line: number; text: string }[] => {
  const q = query.toLowerCase();
  const out: { line: number; text: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (lines[i].toLowerCase().includes(q)) out.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
  }
  return out;
};
