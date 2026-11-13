import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { appliesItself, modeFromSettings, modeNote, refusedInMode, runsItself } from "../../src/chat/modes";
import { chooseModel, modelOptions, providerOf, shortLabel } from "../../src/chat/models";
import { HistoryStore, MAX_CHATS, reopened, titleFor } from "../../src/chat/history";

describe("modes", () => {
  it("plan mode refuses changes and commands, but not reading", () => {
    expect(refusedInMode("plan", "propose_edit")).toMatch(/Plan mode is on/);
    expect(refusedInMode("plan", "run_command")).toMatch(/Plan mode is on/);
    expect(refusedInMode("plan", "read_file")).toBeNull();
    expect(refusedInMode("full", "run_command")).toBeNull();
  });
  it("what happens without a click", () => {
    expect([appliesItself("ask", false), appliesItself("auto", false), appliesItself("auto", true), appliesItself("full", true)]).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect([runsItself("auto"), runsItself("full")]).toEqual([false, true]);
  });
  it("the hidden note names the mode; old autoApply maps to auto", () => {
    expect(modeNote("plan")).toMatch(/^\[Mode: plan/);
    expect(modeFromSettings(undefined, true)).toBe("auto");
    expect(modeFromSettings("full", false)).toBe("full");
    expect(modeFromSettings("bogus", false)).toBe("ask");
  });
});

describe("models", () => {
  const info = {
    claude: true,
    gemini: true,
    models: {
      claude: [
        { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
        { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      ],
      gemini: [{ id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (highest free limits)" }],
    },
    defaults: { claude: "claude-opus-5-5", gemini: "gemini-3.5-flash-lite" },
  };
  it("lists what the person can use", () => {
    expect(modelOptions(info).map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-haiku-5-5", "gemini-3.5-flash-lite"]);
    expect(modelOptions({ ...info, claude: false }).map((m) => m.provider)).toEqual(["gemini"]);
  });
  it("keeps the saved choice when it is still there, else falls back", () => {
    expect(chooseModel(info, "claude-haiku-5-5", undefined)?.id).toBe("claude-haiku-5-5");
    expect(chooseModel(info, "gemini-3.8-flash", undefined)?.id).toBe("gemini-3.5-flash-lite");
    expect(chooseModel({ ...info, gemini: false }, "gemini-3.8-flash", undefined)?.id).toBe("claude-opus-5-5");
    expect(chooseModel(info, undefined, "gemini")?.id).toBe("gemini-3.5-flash-lite");
    expect(chooseModel({ claude: false, gemini: false }, "x", undefined)).toBeNull();
    // An older Hodor without model lists: Claude Opus.
    expect(chooseModel({ claude: true, gemini: false }, undefined, undefined)?.id).toBe("claude-opus-5-5");
  });
  it("short labels for the input box", () => {
    expect(providerOf("gemini-3.8-flash")).toBe("gemini");
    expect(shortLabel({ id: "x", label: "Claude Opus 5.5", provider: "claude" })).toBe("Opus 5.5");
    expect(shortLabel({ id: "x", label: "Gemini 3.5 Flash-Lite (highest free limits)", provider: "gemini" })).toBe("Gemini 3.5 Flash-Lite");
  });
});

describe("history", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hodor-history-"));
  const record = (id: string, updatedAt: number, text = "hi") => ({
    id,
    title: titleFor([{ kind: "user" as const, text }]),
    createdAt: updatedAt,
    updatedAt,
    projectId: "p1",
    model: "claude-opus-5-5",
    messages: [{ role: "user" as const, content: text }],
    items: [{ kind: "user" as const, text }],
  });

  it("saves, lists newest first, loads and deletes", () => {
    const store = new HistoryStore(dir());
    store.save(record("aaa-1", 1, "first"));
    store.save(record("bbb-2", 2, "second"));
    expect(store.list().map((c) => c.title)).toEqual(["second", "first"]);
    expect(store.load("aaa-1")?.messages).toEqual([{ role: "user", content: "first" }]);
    store.delete("aaa-1");
    expect(store.list().map((c) => c.id)).toEqual(["bbb-2"]);
    expect(store.load("missing-1")).toBeNull();
  });
  it("keeps the newest chats only and refuses odd ids", () => {
    const store = new HistoryStore(dir());
    for (let i = 0; i < MAX_CHATS + 3; i++) store.save(record(`c-${i}`, i));
    expect(store.list()).toHaveLength(MAX_CHATS);
    expect(store.list().at(-1)?.id).toBe("c-3");
    expect(() => store.save(record("../x", 1))).toThrow(/Invalid chat id/);
  });
  it("titles come from the first message; reopened chats can't apply old changes", () => {
    expect(titleFor([{ kind: "user", text: "  implement   the events\nplease " }])).toBe("implement the events please");
    expect(titleFor([])).toBe("New chat");
    const items = reopened([
      { kind: "step", id: "r1", icon: "edit", label: "Editing", status: "ok", editId: 1, editStatus: "proposed" },
      { kind: "step", id: "r2", icon: "terminal", label: "Run", status: "running", command: "npm test", commandState: "waiting" },
    ]);
    expect(items[0]).toMatchObject({ editStatus: "expired" });
    expect(items[1]).toMatchObject({ status: "error", commandState: "skipped" });
  });
});
