import { describe, expect, it } from "vitest";
import { initialState, reduce, toolStep } from "../../src/chat/state";

describe("toolStep", () => {
  it("labels each tool the way the developer reads it", () => {
    expect(toolStep("list_events", { status: "not started" })).toEqual({ icon: "events", label: 'Getting "not started" events from Hodor' });
    expect(toolStep("list_events", {})).toEqual({ icon: "events", label: "Getting events from Hodor" });
    expect(toolStep("get_event_details", { event_names: ["a", "b"] })).toEqual({ icon: "events", label: "Getting details of a, b" });
    expect(toolStep("get_tracking_code", { language: "go" })).toEqual({ icon: "code", label: "Getting tracking code (Go)" });
    expect(toolStep("search_code", { query: "signup" })).toEqual({ icon: "search", label: 'Searching code for "signup"' });
    expect(toolStep("list_files", {})).toEqual({ icon: "folder", label: "Listing the project" });
    expect(toolStep("read_file", { path: "src/a.ts", start_line: 40, end_line: 90 })).toEqual({
      icon: "read",
      label: "Reading src/a.ts (lines 40–90)",
      path: "src/a.ts",
      line: 40,
    });
    expect(toolStep("propose_edit", { path: "src/a.ts", summary: "track signup" })).toEqual({
      icon: "edit",
      label: "Editing src/a.ts: track signup",
      path: "src/a.ts",
    });
    expect(toolStep("create_file", { path: "src/analytics/tracking.ts", summary: "tracking file" }).label).toBe(
      "Creating src/analytics/tracking.ts: tracking file"
    );
  });
});

describe("reduce", () => {
  it("collects the conversation and streamed text", () => {
    let s = reduce(initialState, { type: "user", text: "how many?" });
    s = reduce(s, { type: "text", text: "You have " });
    s = reduce(s, { type: "text", text: "2." });
    expect(s.items).toEqual([
      { kind: "user", text: "how many?" },
      { kind: "assistant", text: "You have 2." },
    ]);
    expect(s.running).toBe(true);
  });

  it("starts and finishes steps, and text after a step starts a new message", () => {
    let s = reduce(initialState, { type: "user", text: "go" });
    s = reduce(s, { type: "text", text: "Looking." });
    s = reduce(s, { type: "step_start", id: "t1", icon: "search", label: 'Searching code for "x"' });
    expect(s.items[2]).toMatchObject({ kind: "step", id: "t1", status: "running" });
    s = reduce(s, { type: "step_end", id: "t1", ok: false, detail: "No matches." });
    expect(s.items[2]).toMatchObject({ status: "error", detail: "No matches." });
    s = reduce(s, { type: "text", text: "Done" });
    expect(s.items[3]).toEqual({ kind: "assistant", text: "Done" });
  });

  it("tracks a proposed change until it is applied", () => {
    let s = reduce(initialState, { type: "step_start", id: "t1", icon: "edit", label: "Editing a" });
    s = reduce(s, { type: "step_end", id: "t1", ok: true, editId: 3, editStatus: "proposed" });
    s = reduce(s, { type: "edit", editId: 3, status: "applied" });
    expect(s.items[0]).toMatchObject({ editId: 3, editStatus: "applied" });
  });

  it("offers Retry after a busy Claude and Continue after a lost connection", () => {
    const busy = reduce({ ...initialState, running: true }, { type: "error", code: "overloaded", message: "Couldn't finish — try again." });
    expect(busy).toMatchObject({ running: false, canRetry: true, canContinue: false });
    expect(busy.items.at(-1)).toEqual({ kind: "notice", tone: "error", text: "Couldn't finish — try again.", action: "retry" });

    const lost = reduce({ ...initialState, running: true }, { type: "network" });
    expect(lost).toMatchObject({ running: false, canContinue: true });
    expect(lost.items.at(-1)).toEqual({
      kind: "notice",
      tone: "error",
      text: "Connection lost. Your changes so far are kept.",
      action: "continue",
    });

    const keyOff = reduce(initialState, { type: "error", code: "no_key", message: "AI is off" });
    expect(keyOff.items.at(-1)).toMatchObject({ action: "settings" });
    expect(keyOff.canRetry).toBe(false);
  });

  it("clears Retry and Continue when the next request starts, and can reset", () => {
    let s = reduce(initialState, { type: "network" });
    s = reduce(s, { type: "running", running: true });
    expect(s).toMatchObject({ running: true, canContinue: false, canRetry: false });
    expect(reduce(s, { type: "reset" })).toEqual(initialState);
  });
});

describe("commands", () => {
  it("labels run_command and get_problems", () => {
    expect(toolStep("run_command", { command: "npm test", reason: "run the tests" })).toEqual({ icon: "terminal", label: "Run command: run the tests" });
    expect(toolStep("get_problems", {})).toEqual({ icon: "problems", label: "Checking problems" });
    expect(toolStep("get_problems", { path: "src" }).label).toBe("Checking problems in src");
  });
  it("moves a command from waiting to running to done, with its output", () => {
    let s = reduce(initialState, { type: "step_start", id: "r1", icon: "terminal", label: "Run command", command: "npm test", commandState: "waiting" });
    s = reduce(s, { type: "command", id: "r1", state: "running" });
    s = reduce(s, { type: "command", id: "r1", state: "running", output: "1 passed" });
    s = reduce(s, { type: "command", id: "r1", state: "done" });
    expect(s.items[0]).toMatchObject({ kind: "step", command: "npm test", commandState: "done", output: "1 passed" });
  });
});
