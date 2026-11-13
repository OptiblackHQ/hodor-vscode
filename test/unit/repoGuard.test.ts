import { describe, expect, it } from "vitest";
import { createGuard, folderNames, matchLines, needsReview, workspaceGuard } from "../../src/repoGuard";

const ROOT = "/work/app";
// Fake realpath: one symlink inside the project points outside it.
const realpath = (p: string) => (p.startsWith("/work/app/linked") ? p.replace("/work/app/linked", "/tmp/elsewhere") : p);
const guard = createGuard(ROOT, "logs/\n*.secret\n", realpath);

const reason = (p: string) => {
  const r = guard.resolve(p);
  return r.ok ? "ok" : r.reason;
};

describe("createGuard", () => {
  it("allows normal project files", () => {
    expect(guard.resolve("src/app.ts")).toEqual({ ok: true, abs: "/work/app/src/app.ts", rel: "src/app.ts" });
    expect(guard.resolve("./src/../src/app.ts")).toMatchObject({ ok: true, rel: "src/app.ts" });
    expect(guard.resolve("")).toMatchObject({ ok: true, rel: "" });
  });

  it("refuses paths outside the project", () => {
    expect(reason("../other/x.ts")).toBe("outside the project");
    expect(reason("/etc/passwd")).toBe("outside the project");
    expect(reason("linked/a.ts")).toBe("outside the project (link)");
  });

  it("refuses private files", () => {
    for (const p of [".env", ".env.local", "config/prod.pem", "keys/server.key", "id_rsa", ".npmrc", "a/b/cert.p12"]) {
      expect(reason(p)).toMatch(/^private file/);
    }
  });

  it("refuses dependency, build and ignored paths", () => {
    expect(reason("node_modules/a/index.js")).toBe("skipped folder (node_modules)");
    expect(reason("packages/web/dist/x.js")).toBe("skipped folder (dist)");
    expect(reason(".git/config")).toBe("skipped folder (.git)");
    expect(reason("logs/a.log")).toBe("ignored by .gitignore");
    expect(reason("conf/db.secret")).toBe("ignored by .gitignore");
  });
});

describe("matchLines", () => {
  const text = "import x\nfunction Signup() {\n  // SIGNUP done\n}\nsignup again";
  it("finds lines case-insensitively, with line numbers", () => {
    expect(matchLines(text, "signup", 10)).toEqual([
      { line: 2, text: "function Signup() {" },
      { line: 3, text: "// SIGNUP done" },
      { line: 5, text: "signup again" },
    ]);
  });
  it("stops at max and trims long lines", () => {
    expect(matchLines(text, "signup", 1)).toHaveLength(1);
    expect(matchLines(`${"a".repeat(500)}signup`, "signup", 5)[0].text).toHaveLength(200);
  });
});

describe("createGuard with real links and nested .gitignore files", () => {
  // A fake file system: existing paths, and links (link path -> target).
  const fakeFs = (existing: string[], links: Record<string, string>) => (p: string) => {
    for (const [from, to] of Object.entries(links)) {
      if (p === from || p.startsWith(`${from}/`)) p = to + p.slice(from.length);
    }
    if (!existing.some((e) => e === p)) throw new Error("ENOENT");
    return p;
  };
  const ignores: Record<string, string> = {
    "/real/app": "dist-local/\n",
    "/real/app/packages/api": "secrets.json\n",
    "/real/app/.git/info": "",
  };
  const readIgnore = (dir: string) => ignores[dir] ?? null;

  it("resolves new files through a linked folder and refuses ones that land outside", () => {
    const realpath = fakeFs(["/real/app", "/real/app/src", "/tmp/outside"], { "/real/app/linkdir": "/tmp/outside" });
    const g = createGuard("/real/app", "", realpath, readIgnore);
    expect(g.resolve("linkdir/new.ts")).toEqual({ ok: false, reason: "outside the project (link)" });
    expect(g.resolve("src/new.ts")).toMatchObject({ ok: true, rel: "src/new.ts" });
  });

  it("refuses a link whose target is a private file", () => {
    const realpath = fakeFs(["/real/app", "/real/app/.env"], { "/real/app/notes.txt": "/real/app/.env" });
    const g = createGuard("/real/app", "", realpath, readIgnore);
    expect(g.resolve("notes.txt")).toEqual({ ok: false, reason: "private file (.env)" });
  });

  it("allows new files when the project itself was opened through a link", () => {
    const realpath = fakeFs(["/private/tmp/ws", "/private/tmp/ws/src"], { "/tmp/ws": "/private/tmp/ws" });
    const g = createGuard("/tmp/ws", "", realpath, readIgnore);
    expect(g.resolve("src/analytics/tracking.ts")).toMatchObject({ ok: true, rel: "src/analytics/tracking.ts" });
  });

  it("honours .gitignore files in subfolders", () => {
    const realpath = (p: string) => p;
    const g = createGuard("/real/app", ignores["/real/app"], realpath, readIgnore);
    expect(g.resolve("packages/api/secrets.json")).toEqual({ ok: false, reason: "ignored by .gitignore" });
    expect(g.resolve("packages/api/config.json")).toMatchObject({ ok: true });
    expect(g.resolve("dist-local/x.js")).toEqual({ ok: false, reason: "ignored by .gitignore" });
  });

  it("refuses writes to files that run code, and asks for review on config files", () => {
    const g = createGuard("/real/app", "", (p) => p, readIgnore);
    for (const p of [".vscode/tasks.json", ".github/workflows/ci.yml", ".husky/pre-commit", ".devcontainer/devcontainer.json", ".githooks/post-merge", ".gitlab-ci.yml"]) {
      expect(g.writable(p)).toEqual({ ok: false, reason: "files that run code can't be changed by the chat" });
    }
    expect(g.writable("src/app.ts")).toMatchObject({ ok: true });
    for (const p of ["package.json", ".gitignore", "Makefile", "Dockerfile", "vite.config.ts", "scripts/deploy.sh"]) {
      expect(needsReview(p)).toBe(true);
    }
    expect(needsReview("src/signup.js")).toBe(false);
  });
});

describe("several repos", () => {
  const same = (p: string) => p;
  it("never writes .github, .vscode and the like at any depth (a folder of repos)", () => {
    const g = createGuard("/work/all", "", same);
    expect(g.writable("shop/.github/workflows/ci.yml")).toMatchObject({ ok: false });
    expect(g.writable("shop/.vscode/tasks.json")).toMatchObject({ ok: false });
    expect(g.writable("shop/src/app.ts")).toMatchObject({ ok: true, rel: "shop/src/app.ts" });
  });

  it("one open folder: paths start inside it, as before", () => {
    const w = workspaceGuard([{ name: "app", abs: "/work/app", guard: createGuard("/work/app", "", same) }]);
    expect(w.resolve("src/a.ts")).toMatchObject({ ok: true, rel: "src/a.ts", abs: "/work/app/src/a.ts" });
    expect(w.relOf("/work/app/src/a.ts")).toBe("src/a.ts");
    expect(w.relOf("/elsewhere/a.ts")).toBeNull();
  });

  it("several open folders: each path starts with the folder's name", () => {
    const w = workspaceGuard([
      { name: "shop", abs: "/work/shop", guard: createGuard("/work/shop", "dist-secret/\n", same) },
      { name: "admin", abs: "/code/admin", guard: createGuard("/code/admin", "", same) },
    ]);
    expect(w.resolve("admin/main.go")).toMatchObject({ ok: true, rel: "admin/main.go", abs: "/code/admin/main.go" });
    expect(w.resolve("./shop/src/a.ts")).toMatchObject({ ok: true, rel: "shop/src/a.ts" });
    expect(w.resolve("shop/dist-secret/x")).toMatchObject({ ok: false, reason: "ignored by .gitignore" });
    expect(w.resolve("billing/a.ts")).toMatchObject({ ok: false });
    expect(w.resolve("shop/../admin/main.go")).toMatchObject({ ok: false, reason: "outside the project" });
    expect(w.resolve("")).toMatchObject({ ok: false });
    expect(w.writable("admin/.github/x.yml")).toMatchObject({ ok: false });
    expect(w.relOf("/code/admin/cmd/x.go")).toBe("admin/cmd/x.go");
  });

  it("folder names are unique", () => {
    expect(folderNames(["/a/app", "/b/app", "/c/web"])).toEqual(["app", "app-2", "web"]);
  });
});
