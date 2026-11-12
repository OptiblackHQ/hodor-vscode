import * as os from "os";
import { describe, expect, it } from "vitest";
import { cleanOutput, describeResult, runCommand } from "../../src/commandRunner";

describe("cleanOutput", () => {
  it("removes colour codes and keeps the last frame of progress bars", () => {
    expect(cleanOutput("\u001b[32mok\u001b[0m\n10%\r50%\r100%\n")).toBe("ok\n100%");
  });
  it("keeps only the end of long output", () => {
    const out = cleanOutput("x".repeat(50), 10);
    expect(out).toBe("(earlier output cut)\nxxxxxxxxxx");
  });
});

describe("describeResult", () => {
  it("says how the command ended", () => {
    expect(describeResult({ code: 0, output: "hi", timedOut: false, stopped: false })).toBe("Exit code 0.\nhi");
    expect(describeResult({ code: null, output: "", timedOut: true, stopped: false })).toBe("Stopped after 120 s (time limit).\n(no output)");
    expect(describeResult({ code: null, output: "", timedOut: false, stopped: true })).toMatch(/^Stopped by the developer/);
  });
});

describe("runCommand", () => {
  const node = JSON.stringify(process.execPath);
  it("runs in the folder and returns the exit code and both outputs", async () => {
    const seen: string[] = [];
    const r = await runCommand(`${node} -e "console.log(process.cwd()); console.error('warn'); process.exit(3)"`, os.tmpdir(), {
      onOutput: (all) => seen.push(all),
    });
    expect(r.code).toBe(3);
    expect(r.output).toContain("warn");
    expect(r.output).toContain(require("fs").realpathSync(os.tmpdir()).split("/").pop());
    expect(seen.length).toBeGreaterThan(0);
  });
  it("stops at the time limit", async () => {
    const r = await runCommand(`${node} -e "setTimeout(() => {}, 10000)"`, os.tmpdir(), { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });
  it("stops when the developer stops", async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 200);
    const r = await runCommand(`${node} -e "setTimeout(() => {}, 10000)"`, os.tmpdir(), { signal: abort.signal });
    expect(r.stopped).toBe(true);
  });
});
