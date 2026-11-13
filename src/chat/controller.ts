// Runs the chat: posts the conversation to Hodor, shows progress as it
// streams, runs the repo tools Claude asks for on this machine, and posts the
// results until Claude is done. Applied edits mark their events implemented.

import * as vscode from "vscode";
import { aiTurn, ChatMessage, PendingTool, Provider, ToolResult } from "../aiClient";
import { HodorError } from "../api";
import { EditQueue, Proposal } from "../edits";
import { EventTreeProvider } from "../eventTree";
import { ProjectChoice } from "../projects";
import { RepoTools } from "../repoTools";
import { Session } from "../session";
import { changeStatus } from "../status";
import { describeResult, runCommand } from "../commandRunner";
import { Action, ChatState, initialState, reduce, toolStep } from "./state";

const MAX_REQUESTS = 60;
/** How often live command output is redrawn. */
const OUTPUT_EVERY_MS = 250;
/** Screenshots per message, and in one chat (every request carries the whole chat; Hodor takes 4 MB). */
export const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_CHARS = 1_200_000;
const MAX_CHAT_IMAGE_CHARS = 2_600_000;
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export class ChatController implements vscode.Disposable {
  private state: ChatState = initialState;
  /** The conversation as Hodor last returned it (append-only). */
  private history: ChatMessage[] = [];
  /** The last request body, re-posted by Continue / Retry. */
  private lastRequest: ChatMessage[] | null = null;
  private abort: AbortController | undefined;
  private tools: RepoTools | null = null;
  private queue: EditQueue | null = null;
  private stepCount = 0;
  /** Characters of screenshots in this chat so far. */
  private imageChars = 0;
  /** Which AIs this product can use, and the one picked for this chat. */
  private available: { claude: boolean; gemini: boolean } = { claude: true, gemini: false };
  /** Commands waiting for the developer's Run / Skip, by step id. */
  private readonly decisions = new Map<string, (run: boolean) => void>();
  private readonly changed = new vscode.EventEmitter<ChatState>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly session: Session,
    private readonly choice: ProjectChoice,
    private readonly tree: EventTreeProvider
  ) {}

  get current(): ChatState {
    return this.state;
  }

  /** The AI picked in settings, when it has a key; otherwise the one that has. */
  get provider(): Provider {
    const wanted = vscode.workspace.getConfiguration("hodor").get<Provider>("ai.provider") ?? "claude";
    if (this.available[wanted]) return wanted;
    return this.available.claude ? "claude" : this.available.gemini ? "gemini" : wanted;
  }

  get providers(): { claude: boolean; gemini: boolean } {
    return this.available;
  }

  /** Asks Hodor which AIs this product can use (call when the product or keys change). */
  async loadProviders(): Promise<void> {
    const project = this.choice.project;
    if (!project || !this.session.isSignedIn()) return;
    try {
      this.available = await this.session.client.aiProviders(project.id);
    } catch {
      // Older Hodor without the endpoint: Claude through the product's key.
      this.available = { claude: true, gemini: false };
    }
    this.changed.fire(this.state);
  }

  /** Switching AI starts a new chat: each AI keeps its own (hidden) reasoning. */
  async setProvider(provider: Provider): Promise<void> {
    if (provider === this.provider) return;
    await vscode.workspace.getConfiguration("hodor").update("ai.provider", provider, vscode.ConfigurationTarget.Global);
    this.reset();
  }

  private dispatch(action: Action): void {
    this.state = reduce(this.state, action);
    this.changed.fire(this.state);
  }

  private autoApply(): boolean {
    return vscode.workspace.getConfiguration("hodor").get<boolean>("ai.autoApply") ?? false;
  }

  private async ensureTools(): Promise<RepoTools | null> {
    if (!this.tools) {
      this.tools = await RepoTools.forWorkspace();
      if (this.tools) {
        if (this.queue) this.queue.useTools(this.tools);
        else {
          this.queue = new EditQueue(this.tools);
          this.queue.onDidChange((p) => this.dispatch({ type: "edit", editId: p.id, status: p.status, detail: p.reason }));
        }
      }
    }
    return this.tools;
  }

  /** Sends a message, with screenshots as data: URLs (shrunk by the chat page). */
  async send(text: string, images: string[] = []): Promise<void> {
    const message = text.trim() || (images.length ? "See the screenshot." : "");
    if (!message || this.state.running) return;
    if (!(await this.ensureTools())) {
      vscode.window.showWarningMessage("Open the project folder first: the chat works on the open project.");
      return;
    }
    const blocks: unknown[] = [];
    let chars = 0;
    for (const url of images.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const m = IMAGE_DATA_URL.exec(url);
      if (!m || url.length > MAX_IMAGE_CHARS) {
        vscode.window.showWarningMessage("Hodor: one of the images couldn't be sent (too large or not an image).");
        return;
      }
      chars += url.length;
      blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    if (this.imageChars + chars > MAX_CHAT_IMAGE_CHARS) {
      vscode.window.showWarningMessage("Hodor: this chat has as many screenshots as it can carry. Start a new chat to add more.");
      return;
    }
    this.imageChars += chars;
    this.dispatch({ type: "user", text: message, ...(images.length ? { images: images.slice(0, MAX_IMAGES_PER_MESSAGE) } : {}) });
    const content = blocks.length ? [...blocks, { type: "text", text: message }] : message;
    await this.run([...this.history, { role: "user", content }]);
  }

  /** The file on disk for a path the AI used, or null when it is outside the open folders. */
  async fileFor(rel: string): Promise<string | null> {
    const tools = await this.ensureTools();
    const resolved = tools?.guard.resolve(rel);
    return resolved?.ok ? resolved.abs : null;
  }

  /** Re-posts the last request after a lost connection or a busy Claude. */
  async resume(): Promise<void> {
    if (this.state.running || !this.lastRequest) return;
    await this.run(this.lastRequest);
  }

  stop(): void {
    this.abort?.abort();
  }

  reset(): void {
    this.stop();
    this.decideAll(false);
    this.history = [];
    this.lastRequest = null;
    this.tools = null;
    this.imageChars = 0;
    // Changes proposed in the old chat are dropped, so Apply all can't reach them.
    this.queue?.dispose();
    this.queue = null;
    this.dispatch({ type: "reset" });
  }

  private async run(messages: ChatMessage[]): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    this.dispatch({ type: "running", running: true });
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let request = messages;
    const tools = (await this.ensureTools())!;
    const options = { provider: this.provider, workspace: tools.describe() };
    try {
      for (let n = 0; n < MAX_REQUESTS; n++) {
        this.lastRequest = request;
        let finished = false;
        let next: ChatMessage[] | null = null;
        for await (const event of aiTurn(this.session.client, project.id, request, signal, options)) {
          if (event.type === "text") this.dispatch({ type: "text", text: event.text });
          else if (event.type === "server_tool") {
            const id = `s${++this.stepCount}`;
            this.dispatch({ type: "step_start", id, ...toolStep(event.name, event.input) });
            this.dispatch({ type: "step_end", id, ok: event.ok });
          } else if (event.type === "error") {
            if (event.code !== "refusal") return this.dispatch({ type: "error", code: event.code, message: event.message });
            this.dispatch({ type: "notice", text: event.message });
          } else if (event.type === "done") {
            finished = true;
            this.history = event.messages;
            if (event.stop === "tools") {
              const { results, stopped } = await this.runPending(event.pending, signal);
              next = [...event.messages, { role: "user", content: [...event.serverResults, ...results] }];
              // Keep what ran (applied edits included), so the next message builds on it.
              this.history = next;
              if (stopped) return this.dispatch({ type: "notice", text: "Stopped. Changes made so far are kept." });
            } else if (event.stop === "time") {
              // The request ran out of time on the server; carry on from its progress.
              next = event.messages;
            } else if (event.stop === "max_tokens") {
              this.dispatch({ type: "notice", text: "The answer was cut off. Ask to continue." });
            } else if (event.stop === "limit") {
              this.dispatch({ type: "notice", text: "Paused after many steps. Send “continue” to go on." });
            }
          }
        }
        if (!finished) return this.dispatch({ type: "network" });
        if (!next) return;
        request = next;
      }
      this.dispatch({ type: "notice", text: "Paused after many steps. Send “continue” to go on." });
    } catch (error) {
      if (signal.aborted) return this.dispatch({ type: "notice", text: "Stopped. Changes made so far are kept." });
      if (error instanceof HodorError && error.status) {
        const code = error.status === 412 ? "no_key" : error.status === 429 ? "limit" : "http";
        if (error.status === 412) void this.loadProviders();
        return this.dispatch({ type: "error", code, message: error.message });
      }
      this.dispatch({ type: "network" });
    } finally {
      if (this.state.running) this.dispatch({ type: "running", running: false });
      await this.tree.refresh();
    }
  }

  /** Runs the repo tools; after Stop, the rest are answered as not run. */
  private async runPending(pending: PendingTool[], signal: AbortSignal): Promise<{ results: ToolResult[]; stopped: boolean }> {
    const tools = (await this.ensureTools())!;
    const results: ToolResult[] = [];
    for (const call of pending) {
      if (signal.aborted) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "Not run: the developer stopped.", is_error: true });
        continue;
      }
      const id = `r${++this.stepCount}`;
      const command = call.name === "run_command" ? { command: String(call.input.command), commandState: "waiting" as const } : {};
      this.dispatch({ type: "step_start", id, ...toolStep(call.name, call.input), ...command });
      const result = (content: string, ok = true) => {
        results.push({ type: "tool_result", tool_use_id: call.id, content, ...(ok ? {} : { is_error: true }) });
      };
      try {
        const input = call.input;
        if (call.name === "search_code") {
          const out = await tools.search(input.query, input.glob);
          this.dispatch({ type: "step_end", id, ok: true, detail: out === "No matches." ? "No matches" : undefined });
          result(out);
        } else if (call.name === "list_files") {
          result(await tools.list(input.path));
          this.dispatch({ type: "step_end", id, ok: true });
        } else if (call.name === "read_file") {
          result((await tools.read(input.path, input.start_line, input.end_line)).text);
          this.dispatch({ type: "step_end", id, ok: true });
        } else if (call.name === "get_problems") {
          result(tools.problems(input.path));
          this.dispatch({ type: "step_end", id, ok: true });
        } else if (call.name === "run_command") {
          result(...(await this.command(id, input.command, tools.cwd(input.cwd), signal)));
        } else {
          result(...(await this.change(id, call)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.dispatch({ type: "step_end", id, ok: false, detail: message });
        result(message, false);
      }
    }
    return { results, stopped: signal.aborted };
  }

  /**
   * run_command: waits for the developer's Run or Skip (never runs on its own,
   * even with auto-apply), then runs it in the project folder with live output.
   */
  private async command(id: string, command: string, cwd: string, signal: AbortSignal): Promise<[string, boolean]> {
    const run = await new Promise<boolean>((resolve) => {
      if (signal.aborted) return resolve(false);
      this.decisions.set(id, resolve);
      signal.addEventListener("abort", () => this.decide(id, false), { once: true });
    });
    if (!run) {
      this.dispatch({ type: "command", id, state: "skipped" });
      this.dispatch({ type: "step_end", id, ok: true, detail: undefined });
      return [signal.aborted ? "Not run: the developer stopped." : "The developer skipped this command. Don't run it again unless they ask; carry on without it.", !signal.aborted];
    }
    this.dispatch({ type: "command", id, state: "running" });
    let latest: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const result = await runCommand(command, cwd, {
      signal,
      onOutput: (all) => {
        latest = all;
        timer ??= setTimeout(() => {
          timer = undefined;
          this.dispatch({ type: "command", id, state: "running", output: latest });
        }, OUTPUT_EVERY_MS);
      },
    });
    if (timer) clearTimeout(timer);
    this.dispatch({ type: "command", id, state: "done", output: result.output });
    const ok = result.code === 0 && !result.timedOut && !result.stopped;
    const detail = ok ? undefined : result.stopped ? "Stopped" : result.timedOut ? "Time limit reached" : `Exit code ${result.code}`;
    this.dispatch({ type: "step_end", id, ok, detail });
    return [describeResult(result), ok];
  }

  /** The developer's click on Run (true) or Skip (false). */
  decide(stepId: string, run: boolean): void {
    const resolve = this.decisions.get(stepId);
    if (!resolve) return;
    this.decisions.delete(stepId);
    resolve(run);
  }

  private decideAll(run: boolean): void {
    for (const id of [...this.decisions.keys()]) this.decide(id, run);
  }

  /** propose_edit / create_file: queue it, and apply it now when auto-apply is on. */
  private async change(stepId: string, call: PendingTool): Promise<[string, boolean]> {
    const input = call.input;
    const proposal = this.queue!.propose({
      kind: call.name === "create_file" ? "create" : "edit",
      path: input.path,
      oldText: input.old_text,
      newText: call.name === "create_file" ? input.content : input.new_text,
      eventNames: input.event_names || [],
      summary: input.summary || "",
    });
    if (typeof proposal === "string") {
      this.dispatch({ type: "step_end", id: stepId, ok: false, detail: proposal });
      return [proposal, false];
    }
    this.dispatch({ type: "step_end", id: stepId, ok: true, editId: proposal.id, editStatus: "proposed" });
    if (!this.autoApply() || proposal.needsReview) {
      return [`Proposed to the developer for review (change ${proposal.id}). Continue with the other events.`, true];
    }
    const applied = await this.applyChange(proposal.id);
    return applied.status === "applied" ? ["Applied.", true] : [`Not applied: ${applied.reason}.`, false];
  }

  /** Applies a queued change; when it implements events, marks them implemented in Hodor. */
  async applyChange(editId: number): Promise<Proposal> {
    const applied = await this.queue!.apply(editId);
    if (applied.status === "applied") await this.markImplemented(applied.eventNames);
    return applied;
  }

  async applyAll(): Promise<void> {
    if (!this.queue) return;
    for (const p of [...this.queue.proposals.values()]) if (p.status === "proposed") await this.applyChange(p.id);
    await this.tree.refresh();
  }

  skip(editId: number): void {
    this.queue?.skip(editId);
  }

  diff(editId: number): Promise<void> {
    return this.queue?.diff(editId) ?? Promise.resolve();
  }

  private async markImplemented(names: string[]): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    for (const name of names) {
      const event = this.tree.getEventByName(name);
      if (!event || event.status === "implemented") continue;
      const id = `m${++this.stepCount}`;
      this.dispatch({ type: "step_start", id, icon: "status", label: `Marking ${name} implemented in Hodor` });
      const result = await changeStatus(this.session.client, project.id, event, "implemented");
      this.dispatch({ type: "step_end", id, ok: result.ok, detail: result.ok ? undefined : result.message });
      if (result.ok) event.status = "implemented";
      if (result.ok) event.version = result.version;
    }
  }

  dispose(): void {
    this.stop();
    this.decideAll(false);
    this.queue?.dispose();
    this.changed.dispose();
  }
}
