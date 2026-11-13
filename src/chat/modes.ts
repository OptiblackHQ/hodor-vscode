// The chat's modes, like Claude Code's: what the AI may do without asking.
// Pure (no VS Code), so it is unit tested.

export type Mode = "plan" | "ask" | "auto" | "full";

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "Reads the code and writes a plan. Changes nothing." },
  { id: "ask", label: "Ask before edits", hint: "Every change waits for Apply, every command for Run." },
  { id: "auto", label: "Edit automatically", hint: "Changes apply right away. Commands still ask." },
  { id: "full", label: "Full access", hint: "Changes and commands run without asking." },
];

export const isMode = (value: unknown): value is Mode => MODES.some((m) => m.id === value);

const CHANGES = new Set(["propose_edit", "create_file", "run_command", "stop_command"]);

/** Why a tool can't run in this mode, or null when it can. */
export const refusedInMode = (mode: Mode, tool: string): string | null =>
  mode === "plan" && CHANGES.has(tool)
    ? "Plan mode is on: don't change files or run commands. Finish exploring and present your plan; the developer approves it first."
    : null;

/** A change applies without the developer's click (review-only files always wait, except in full access). */
export const appliesItself = (mode: Mode, needsReview: boolean): boolean => mode === "full" || (mode === "auto" && !needsReview);

/** A command runs without the developer's click. */
export const runsItself = (mode: Mode): boolean => mode === "full";

/**
 * The note added (hidden) to the developer's message, so the AI knows the mode.
 * It goes in the message rather than the instructions: changing instructions
 * mid-chat would throw away the AI's cached context.
 */
export const modeNote = (mode: Mode): string =>
  ({
    plan: "[Mode: plan. Explore the code and reply with a numbered plan: what you'll change, where, and how you'll check it. Don't edit files or run commands yet.]",
    ask: "[Mode: ask before edits. The developer reviews each change and command.]",
    auto: "[Mode: edit automatically. Changes apply right away; commands still need the developer's OK.]",
    full: "[Mode: full access. Changes and commands run right away; still never do anything destructive unless asked.]",
  })[mode];

/** The developer's mode from settings (older versions had only the autoApply switch). */
export const modeFromSettings = (mode: unknown, autoApply: unknown): Mode => (isMode(mode) ? mode : autoApply === true ? "auto" : "ask");
