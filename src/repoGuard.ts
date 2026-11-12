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

// Folders and files whose contents run on their own (editor tasks, git hooks,
// CI): the chat may never write them, review or not.
const NO_WRITE_DIRS = [".vscode", ".github", ".husky", ".githooks", ".devcontainer", ".circleci"];
const NO_WRITE_FILES = [".gitlab-ci.yml", ".travis.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml"];

// Build, dependency and config files: the chat may change them, but always
// through review, even with auto-apply on.
const REVIEW_FILES = [
  "package.json", ".gitignore", "Makefile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "pyproject.toml",
  "setup.py", "requirements.txt", "go.mod", "Gemfile", "composer.json", "build.gradle", "build.gradle.kts", "Podfile",
  "pubspec.yaml", "tsconfig.json",
];
const REVIEW_PATTERNS = [/\.config\.(js|cjs|mjs|ts|json)$/i, /\.(sh|bash|zsh|ps1|bat|cmd)$/i, /^\.[a-z]+rc(\.(js|cjs|json|ya?ml))?$/i];

export const needsReview = (rel: string): boolean => {
  const name = rel.split("/").pop() || "";
  return REVIEW_FILES.includes(name) || REVIEW_PATTERNS.some((re) => re.test(name));
};

/**
 * @param gitignoreText the root .gitignore plus .git/info/exclude
 * @param realpath      fs.realpathSync (throws for missing paths)
 * @param readIgnore    a folder's own .gitignore text, or null (for nested .gitignore files)
 */
export const createGuard = (
  root: string,
  gitignoreText: string,
  realpath: (p: string) => string,
  readIgnore: (dir: string) => string | null = () => null
) => {
  /** The real path, following links; for a missing file, its nearest existing folder's real path plus the rest. */
  const realpathDeep = (p: string): string => {
    let rest = "";
    let current = p;
    for (;;) {
      try {
        return path.join(realpath(current), rest);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return p;
        rest = path.join(path.basename(current), rest);
        current = parent;
      }
    }
  };
  const realRoot = realpathDeep(root);
  const outside = (rel: string) => rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  const toPosix = (rel: string) => rel.split(path.sep).join("/");

  const rootRules = ignore().add(gitignoreText);
  const nested = new Map<string, ReturnType<typeof ignore> | null>();
  const rulesFor = (dirRel: string) => {
    if (!nested.has(dirRel)) {
      const text = readIgnore(path.join(root, dirRel));
      nested.set(dirRel, text ? ignore().add(text) : null);
    }
    return nested.get(dirRel)!;
  };
  const ignored = (posix: string) => {
    const parts = posix.split("/");
    for (let i = 0; i < parts.length; i++) {
      const rules = i === 0 ? rootRules : rulesFor(parts.slice(0, i).join("/"));
      const sub = parts.slice(i).join("/");
      if (rules && (rules.ignores(sub) || rules.ignores(`${sub}/`))) return true;
    }
    return false;
  };

  /** The reason a project-relative path is off limits, or null. */
  const refusal = (posix: string): string | null => {
    if (!posix) return null;
    const parts = posix.split("/");
    const skipped = parts.find((p) => SKIPPED_DIRS.includes(p));
    if (skipped) return `skipped folder (${skipped})`;
    const name = parts[parts.length - 1];
    if (PRIVATE_FILES.some((re) => re.test(name))) return `private file (${name})`;
    if (ignored(posix)) return "ignored by .gitignore";
    return null;
  };

  const resolve = (input: string): Resolved => {
    if (input.includes("\0")) return { ok: false, reason: "invalid path" };
    const abs = path.resolve(root, input || ".");
    const rel = path.relative(root, abs);
    if (outside(rel)) return { ok: false, reason: "outside the project" };
    const realRel = path.relative(realRoot, realpathDeep(abs));
    if (outside(realRel)) return { ok: false, reason: "outside the project (link)" };
    // Check both the path as written and where it really leads (a link to .env).
    const reason = refusal(toPosix(rel)) || refusal(toPosix(realRel));
    if (reason) return { ok: false, reason };
    return { ok: true, abs, rel: toPosix(rel) };
  };

  return {
    resolve,
    /** Like resolve, but also refuses files that run code (editor tasks, git hooks, CI). */
    writable(input: string): Resolved {
      const resolved = resolve(input);
      if (!resolved.ok) return resolved;
      const parts = resolved.rel.split("/");
      if (NO_WRITE_DIRS.includes(parts[0]) || NO_WRITE_FILES.includes(parts[parts.length - 1])) {
        return { ok: false, reason: "files that run code can't be changed by the chat" };
      }
      return resolved;
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
