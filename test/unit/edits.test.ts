import { describe, expect, it } from "vitest";
import { planCreate, planEdit } from "../../src/editPlan";

describe("planEdit", () => {
  const file = "a\n  // signup done\nb\n";
  it("replaces text found exactly once", () => {
    expect(planEdit(file, "  // signup done", "  track();\n  // signup done")).toEqual({
      ok: true,
      next: "a\n  track();\n  // signup done\nb\n",
    });
  });
  it("refuses text that is missing or appears more than once", () => {
    expect(planEdit(file, "nothing", "x")).toEqual({ ok: false, reason: "the text to replace was not found" });
    expect(planEdit("x\nx\n", "x", "y")).toEqual({ ok: false, reason: "the text to replace appears 2 times" });
  });
  it("keeps Windows line endings", () => {
    const crlf = "a\r\n  // signup done\r\nb\r\n";
    expect(planEdit(crlf, "  // signup done", "  track();\n  // signup done")).toEqual({
      ok: true,
      next: "a\r\n  track();\r\n  // signup done\r\nb\r\n",
    });
  });
});

describe("planCreate", () => {
  it("refuses to overwrite", () => {
    expect(planCreate(true)).toEqual({ ok: false, reason: "the file already exists" });
    expect(planCreate(false)).toEqual({ ok: true });
  });
});
