// Runs one shell command the developer approved in the chat, in the project
// folder, with a time limit. Output streams to the chat as it comes; what goes
// back to Claude is cleaned (no colour codes) and capped.
// No VS Code import, so it is unit tested.

import { spawn } from "child_process";

export const COMMAND_TIMEOUT_MS = 120 * 1000;
const MAX_OUTPUT = 16 * 1024;

export interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  stopped: boolean;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** Colour codes removed, carriage-return progress bars collapsed, and only the end kept when long. */
export const cleanOutput = (raw: string, max = MAX_OUTPUT): string => {
  const text = raw
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).pop() ?? "")
    .join("\n")
    .trimEnd();
  return text.length > max ? `(earlier output cut)\n${text.slice(-max)}` : text;
};

/** What Claude reads back. */
export const describeResult = (r: CommandResult, timeoutMs = COMMAND_TIMEOUT_MS): string => {
  const status = r.stopped
    ? "Stopped by the developer."
    : r.timedOut
      ? `Stopped after ${timeoutMs / 1000} s (time limit).`
      : `Exit code ${r.code}.`;
  return `${status}\n${r.output || "(no output)"}`;
};

export const runCommand = (
  command: string,
  cwd: string,
  { signal, onOutput, timeoutMs = COMMAND_TIMEOUT_MS }: { signal?: AbortSignal; onOutput?: (all: string) => void; timeoutMs?: number } = {}
): Promise<CommandResult> =>
  new Promise((resolve) => {
    const windows = process.platform === "win32";
    // Its own process group on macOS/Linux, so Stop also ends whatever it started.
    const child = spawn(command, { cwd, shell: true, detached: !windows, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let raw = "";
    let timedOut = false;
    let stopped = false;
    const kill = () => {
      try {
        if (!windows && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill();
      } catch {
        child.kill();
      }
    };
    const onData = (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      // Keep memory bounded on chatty commands.
      if (raw.length > MAX_OUTPUT * 8) raw = raw.slice(-MAX_OUTPUT * 4);
      onOutput?.(cleanOutput(raw));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.stdin?.end();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const abort = () => {
      stopped = true;
      kill();
    };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    const finish = (code: number | null, extra = "") => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, output: cleanOutput(raw + extra), timedOut, stopped });
    };
    child.on("error", (error) => finish(null, `\n${error.message}`));
    child.on("close", (code) => finish(code));
  });

export interface BackgroundInfo {
  id: string;
  command: string;
  running: boolean;
  code: number | null;
}

/**
 * Commands that keep running (dev servers, watchers), started by the AI with
 * run_command background: true. Output is kept (the latest part) so the AI can
 * read it later; everything is stopped when the chat ends.
 */
export class BackgroundCommands {
  private next = 1;
  private readonly procs = new Map<string, { command: string; raw: string; code: number | null; running: boolean; abort: AbortController; done: Promise<void> }>();

  /** Starts it and returns its id once there is first output (or after `firstWaitMs`). */
  async start(command: string, cwd: string, firstWaitMs = 8000): Promise<{ id: string; output: string; running: boolean; code: number | null }> {
    const id = `bg${this.next++}`;
    const abort = new AbortController();
    const entry = { command, raw: "", code: null as number | null, running: true, abort, done: Promise.resolve() };
    let firstOutput: () => void = () => {};
    const first = new Promise<void>((resolve) => (firstOutput = resolve));
    entry.done = runCommand(command, cwd, {
      signal: abort.signal,
      timeoutMs: 24 * 60 * 60 * 1000,
      onOutput: (all) => {
        entry.raw = all;
        firstOutput();
      },
    }).then((r) => {
      entry.raw = r.output;
      entry.code = r.code;
      entry.running = false;
      firstOutput();
    });
    this.procs.set(id, entry);
    // Give it a moment to print its first lines (e.g. "ready on :3000").
    await Promise.race([first.then(() => new Promise((r) => setTimeout(r, 1500))), new Promise((r) => setTimeout(r, firstWaitMs))]);
    return { id, output: entry.raw, running: entry.running, code: entry.code };
  }

  /** The output so far, after waiting up to `waitMs` for it to finish or print more. */
  async output(id: string, waitMs = 0): Promise<{ output: string; running: boolean; code: number | null }> {
    const entry = this.procs.get(id);
    if (!entry) throw new Error(`No background command ${id}.`);
    if (waitMs > 0 && entry.running) await Promise.race([entry.done, new Promise((r) => setTimeout(r, waitMs))]);
    return { output: entry.raw, running: entry.running, code: entry.code };
  }

  async stop(id: string): Promise<void> {
    const entry = this.procs.get(id);
    if (!entry) throw new Error(`No background command ${id}.`);
    entry.abort.abort();
    await entry.done;
  }

  list(): BackgroundInfo[] {
    return [...this.procs.entries()].map(([id, e]) => ({ id, command: e.command, running: e.running, code: e.code }));
  }

  stopAll(): void {
    for (const e of this.procs.values()) e.abort.abort();
  }
}
