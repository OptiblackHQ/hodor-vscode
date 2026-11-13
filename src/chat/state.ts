// What the chat shows, as plain data: messages, live progress steps and
// notices. Pure (no VS Code), so it is unit tested; the view renders it.

import { languageLabel } from "../snippet";

export type Icon = "events" | "code" | "search" | "folder" | "read" | "edit" | "status" | "terminal" | "problems";
/** A command Claude wants to run: waiting for Run/Skip, running, then done or skipped. */
export type CommandState = "waiting" | "running" | "done" | "skipped";
export type EditStatus = "proposed" | "applied" | "skipped" | "failed" | "expired";

export type Item =
  | { kind: "user"; text: string; images?: string[] }
  | { kind: "assistant"; text: string }
  | {
      kind: "step";
      id: string;
      icon: Icon;
      label: string;
      status: "running" | "ok" | "error";
      detail?: string;
      path?: string;
      line?: number;
      editId?: number;
      editStatus?: EditStatus;
      command?: string;
      commandState?: CommandState;
      output?: string;
    }
  | { kind: "notice"; tone: "error" | "info"; text: string; action?: "retry" | "continue" | "settings" };

export interface ChatState {
  items: Item[];
  running: boolean;
  canContinue: boolean;
  canRetry: boolean;
  /** A plan-mode answer is ready: the chat offers "Approve plan". */
  planReady: boolean;
}

export const initialState: ChatState = { items: [], running: false, canContinue: false, canRetry: false, planReady: false };

export type Action =
  | { type: "user"; text: string; images?: string[] }
  | { type: "text"; text: string }
  | { type: "step_start"; id: string; icon: Icon; label: string; path?: string; line?: number; command?: string; commandState?: CommandState }
  | { type: "step_end"; id: string; ok: boolean; detail?: string; editId?: number; editStatus?: EditStatus }
  | { type: "edit"; editId: number; status: EditStatus; detail?: string }
  | { type: "command"; id: string; state: CommandState; output?: string }
  | { type: "error"; code: string; message: string }
  | { type: "notice"; text: string }
  | { type: "network" }
  | { type: "running"; running: boolean }
  | { type: "plan_ready"; ready: boolean }
  | { type: "load"; items: Item[] }
  | { type: "reset" };

const quote = (s: unknown) => `"${String(s ?? "").slice(0, 60)}"`;

/** The progress line for a tool call. */
export const toolStep = (name: string, input: Record<string, any>): { icon: Icon; label: string; path?: string; line?: number } => {
  switch (name) {
    case "list_events":
      return { icon: "events", label: input.status ? `Getting ${quote(input.status)} events from Hodor` : "Getting events from Hodor" };
    case "get_event_details":
      return { icon: "events", label: `Getting details of ${(input.event_names || []).join(", ")}` };
    case "get_tracking_code":
      return { icon: "code", label: `Getting tracking code (${languageLabel(String(input.language || ""))})` };
    case "search_code":
      return { icon: "search", label: `Searching code for ${quote(input.query)}` };
    case "list_files":
      return { icon: "folder", label: input.path ? `Listing ${input.path}` : "Listing the project" };
    case "read_file": {
      const lines = input.start_line ? ` (lines ${input.start_line}–${input.end_line ?? input.start_line + 399})` : "";
      return { icon: "read", label: `Reading ${input.path}${lines}`, path: input.path, ...(input.start_line ? { line: input.start_line } : {}) };
    }
    case "propose_edit":
      return { icon: "edit", label: `Editing ${input.path}: ${input.summary}`, path: input.path };
    case "create_file":
      return { icon: "edit", label: `Creating ${input.path}: ${input.summary}`, path: input.path };
    case "run_command":
      return { icon: "terminal", label: `${input.background ? "Start" : "Run"}: ${input.reason || input.command}` };
    case "command_output":
      return { icon: "terminal", label: `Checking output of ${input.id}` };
    case "stop_command":
      return { icon: "terminal", label: `Stopping ${input.id}` };
    case "get_problems":
      return { icon: "problems", label: input.path ? `Checking problems in ${input.path}` : "Checking problems" };
    default:
      return { icon: "code", label: name };
  }
};

const ACTIONS: Record<string, "retry" | "settings" | undefined> = {
  overloaded: "retry",
  quota: "retry",
  no_key: "settings",
  bad_key: "settings",
};

export const reduce = (state: ChatState, action: Action): ChatState => {
  const items = state.items;
  switch (action.type) {
    case "user":
      return {
        ...state,
        items: [...items, { kind: "user", text: action.text, ...(action.images?.length ? { images: action.images } : {}) }],
        running: true,
        canContinue: false,
        canRetry: false,
        planReady: false,
      };
    case "text": {
      const last = items[items.length - 1];
      if (last?.kind === "assistant") return { ...state, items: [...items.slice(0, -1), { ...last, text: last.text + action.text }] };
      return { ...state, items: [...items, { kind: "assistant", text: action.text }] };
    }
    case "step_start":
      return { ...state, items: [...items, { kind: "step", status: "running", ...withoutType(action) }] };
    case "step_end":
      return {
        ...state,
        items: items.map((item) =>
          item.kind === "step" && item.id === action.id
            ? {
                ...item,
                status: action.ok ? "ok" : "error",
                ...(action.detail ? { detail: action.detail } : {}),
                ...(action.editId ? { editId: action.editId, editStatus: action.editStatus } : {}),
              }
            : item
        ),
      };
    case "edit":
      return {
        ...state,
        items: items.map((item) =>
          item.kind === "step" && item.editId === action.editId
            ? { ...item, editStatus: action.status, ...(action.detail ? { detail: action.detail } : {}) }
            : item
        ),
      };
    case "command":
      return {
        ...state,
        items: items.map((item) =>
          item.kind === "step" && item.id === action.id
            ? { ...item, commandState: action.state, ...(action.output !== undefined ? { output: action.output } : {}) }
            : item
        ),
      };
    case "error": {
      const act = ACTIONS[action.code];
      const notice: Item = { kind: "notice", tone: "error", text: action.message, ...(act ? { action: act } : {}) };
      return { ...state, items: [...items, notice], running: false, canRetry: act === "retry" };
    }
    case "notice":
      return { ...state, items: [...items, { kind: "notice", tone: "info", text: action.text }] };
    case "network":
      return {
        ...state,
        items: [...items, { kind: "notice", tone: "error", text: "Connection lost. Your changes so far are kept.", action: "continue" }],
        running: false,
        canContinue: true,
      };
    case "running":
      return action.running
        ? { ...state, running: true, canContinue: false, canRetry: false }
        : { ...state, running: false };
    case "plan_ready":
      return { ...state, planReady: action.ready };
    case "load":
      return { ...initialState, items: action.items };
    case "reset":
      return initialState;
  }
};

function withoutType<T extends { type: string }>(action: T): Omit<T, "type"> {
  const { type: _type, ...rest } = action;
  return rest;
}
