import { describe, expect, it } from "vitest";
import { createGuard, matchLines } from "../../src/repoGuard";

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
