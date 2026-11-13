// Runs the chat: posts the conversation to Hodor, shows progress as it
// streams, runs the repo tools the AI asks for on this machine, and posts the
// results until the AI is done. Applied edits mark their events implemented.
// Chats are saved (history.ts); the mode (modes.ts) decides what runs without
// a click; the model (models.ts) picks Claude or Gemini.

import * as vscode from "vscode";
import { aiTurn, ChatMessage, PendingTool, ToolResult } from "../aiClient";
import { HodorError } from "../api";
import { BackgroundCommands, cleanOutput, COMMAND_TIMEOUT_MS, describeResult, runCommand } from "../commandRunner";
import { EditQueue, Proposal } from "../edits";
import { EventTreeProvider } from "../eventTree";
import { ProjectChoice } from "../projects";
import { RepoTools } from "../repoTools";
import { Session } from "../session";
import { changeStatus } from "../status";
import { ChatRecord, ChatSummary, HistoryStore, newChatId, reopened, titleFor } from "./history";
import { appliesItself, isMode, Mode, modeFromSettings, modeNote, refusedInMode, runsItself } from "./modes";
import { chooseModel, ModelOption, modelOptions, Provider, providerOf, ProvidersInfo } from "./models";
import { Action, ChatState, initialState, reduce, toolStep } from "./state";

const MAX_REQUESTS = 60;
/** How often live command output is redrawn. */
const OUTPUT_EVERY_MS = 250;
/** Screenshots per message, and in one chat (every request carries the whole chat; Hodor takes 4 MB). */
export const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_CHARS = 1_200_000;
const MAX_CHAT_IMAGE_CHARS = 2_600_000;
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

const config = () => vscode.workspace.getConfiguration("hodor");

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
  /** What Hodor says this person can use for this product. */
  private info: ProvidersInfo = { claude: true, gemini: false };
  /** This chat's id and model (a reopened chat keeps the model it used). */
  private chatId = newChatId();
  private createdAt = Date.now();
  private chatModel: string | null = null;
  /** The mode to return to after a plan is approved. */
  private lastWorkMode: Mode = "ask";
  /** Commands waiting for the developer's Run / Skip, by step id. */
  private readonly decisions = new Map<string, (run: boolean) => void>();
  private readonly background = new BackgroundCommands();
  private readonly changed = new vscode.EventEmitter<ChatState>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly session: Session,
    private readonly choice: ProjectChoice,
    private readonly tree: EventTreeProvider,
    private readonly store: HistoryStore | null = null
  ) {}

  get current(): ChatState {
    return this.state;
  }

  // ---- model and mode -------------------------------------------------------

  /** Every model this person can pick for this product. */
  get models(): ModelOption[] {
    return modelOptions(this.info);
  }

  /** The model this chat uses. */
  get model(): ModelOption | null {
    const saved = this.chatModel ?? config().get<string>("ai.model") ?? undefined;
    return chooseModel(this.info, saved || undefined, config().get<Provider>("ai.provider"));
  }

  get provider(): Provider {
    return this.model?.provider ?? "claude";
  }

  get providers(): { claude: boolean; gemini: boolean } {
    return { claude: this.info.claude, gemini: this.info.gemini };
  }

  get mode(): Mode {
    // Only a mode the developer set counts; otherwise the old autoApply switch decides.
    const set = config().inspect<string>("ai.mode");
    const chosen = set?.workspaceFolderValue ?? set?.workspaceValue ?? set?.globalValue;
    return modeFromSettings(chosen, config().get("ai.autoApply"));
  }

  /** Asks Hodor which AIs and models this product can use (call when the product or keys change). */
  async loadProviders(): Promise<void> {
    const project = this.choice.project;
    if (!project || !this.session.isSignedIn()) return;
    try {
      this.info = await this.session.client.aiProviders(project.id);
    } catch {
      // Older Hodor without the endpoint: Claude through the product's key.
      this.info = { claude: true, gemini: false };
    }
    this.changed.fire(this.state);
  }

  /**
   * Changing the model starts a new chat (each model keeps its own hidden
   * reasoning); the current chat stays in the history.
   */
  async setModel(id: string): Promise<void> {
    if (!this.models.some((m) => m.id === id) || id === this.model?.id) return;
    await config().update("ai.model", id, vscode.ConfigurationTarget.Global);
    await config().update("ai.provider", providerOf(id), vscode.ConfigurationTarget.Global);
    this.newChat();
  }

  /** Older callers (and tests) pick an AI rather than a model. */
  async setProvider(provider: Provider): Promise<void> {
    if (provider === this.provider) return;
    const target = this.info.defaults?.[provider] || this.models.find((m) => m.provider === provider)?.id;
    if (target) await this.setModel(target);
    else {
      await config().update("ai.provider", provider, vscode.ConfigurationTarget.Global);
      this.newChat();
    }
  }

  async setMode(mode: Mode): Promise<void> {
    if (!isMode(mode) || mode === this.mode) return;
    if (mode === "full") {
      const ok = await vscode.window.showWarningMessage(
        "Full access: the chat will change files and run commands without asking. Protected folders (.github, .vscode) and private files (.env, keys) stay blocked.",
        { modal: true },
        "Turn on full access"
      );
      if (ok !== "Turn on full access") return this.changed.fire(this.state);
    }
    if (mode !== "plan") this.lastWorkMode = mode;
    await config().update("ai.mode", mode, vscode.ConfigurationTarget.Global);
    if (mode !== "plan") this.dispatch({ type: "plan_ready", ready: false });
    // Commands waiting for a click run now in full access.
    if (mode === "full") for (const id of [...this.decisions.keys()]) this.decide(id, true);
    this.changed.fire(this.state);
  }

  /** "Approve plan": back to the working mode, and go. */
  async approvePlan(): Promise<void> {
    if (this.state.running) return;
    const back = this.lastWorkMode === "plan" ? "ask" : this.lastWorkMode;
    await this.setMode(back);
    await this.send("The plan is approved. Go ahead and implement it, then check your work.");
  }

  // ---- history --------------------------------------------------------------

  listChats(): ChatSummary[] {
    const project = this.choice.project;
    return (this.store?.list() || []).filter((c) => !project || c.projectId === project.id);
  }

  get chatIdNow(): string {
    return this.chatId;
  }

  private save(): void {
    const project = this.choice.project;
    if (!this.store || !project || !this.state.items.length) return;
    const record: ChatRecord = {
      id: this.chatId,
      title: titleFor(this.state.items),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      projectId: project.id,
      model: this.model?.id || "",
      messages: this.history,
      items: this.state.items,
    };
    try {
      this.store.save(record);
    } catch (error) {
      console.error("Hodor: couldn't save the chat", error);
    }
  }

  /** Reopens a saved chat to read or continue it. */
  openChat(id: string): boolean {
    const record = this.store?.load(id);
    if (!record || this.state.running) return false;
    this.clear();
    this.chatId = record.id;
    this.createdAt = record.createdAt;
    this.chatModel = record.model || null;
    this.history = record.messages;
    this.dispatch({ type: "load", items: reopened(record.items) });
    return true;
  }

  deleteChat(id: string): void {
    this.store?.delete(id);
    if (id === this.chatId) this.newChat();
    else this.changed.fire(this.state);
  }

  // ---- the conversation -----------------------------------------------------

  private dispatch(action: Action): void {
    this.state = reduce(this.state, action);
    this.changed.fire(this.state);
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
    // A new chat keeps the model it started with.
    this.chatModel ??= this.model?.id ?? null;
    this.dispatch({ type: "user", text: message, ...(images.length ? { images: images.slice(0, MAX_IMAGES_PER_MESSAGE) } : {}) });
    // The mode goes along as a hidden note, so the AI knows what it may do.
    const content = [...blocks, { type: "text", text: modeNote(this.mode) }, { type: "text", text: message }];
    this.save();
    await this.run([...this.history, { role: "user", content }]);
  }

  /** The file on disk for a path the AI used, or null when it is outside the open folders. */
  async fileFor(rel: string): Promise<string | null> {
    const tools = await this.ensureTools();
    const resolved = tools?.guard.resolve(rel);
    return resolved?.ok ? resolved.abs : null;
  }

  /** Re-posts the last request after a lost connection or a busy AI. */
  async resume(): Promise<void> {
    if (this.state.running || !this.lastRequest) return;
    await this.run(this.lastRequest);
  }

  stop(): void {
    this.abort?.abort();
  }

  /** Clears the chat in memory (the saved copy stays in the history). */
  private clear(): void {
    this.stop();
    this.decideAll(false);
    this.background.stopAll();
    this.history = [];
    this.lastRequest = null;
    this.tools = null;
    this.imageChars = 0;
    // Changes proposed in the old chat are dropped, so Apply all can't reach them.
    this.queue?.dispose();
    this.queue = null;
  }

  /** Starts a new chat. */
  newChat(): void {
    this.clear();
    this.chatId = newChatId();
    this.createdAt = Date.now();
    this.chatModel = null;
    this.dispatch({ type: "reset" });
  }

  /** Kept for callers from before history: same as newChat. */
  reset(): void {
    this.newChat();
  }

  private async run(messages: ChatMessage[]): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    this.dispatch({ type: "running", running: true });
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let request = messages;
    const tools = (await this.ensureTools())!;
    const model = this.model;
    const options = { provider: model?.provider ?? "claude", model: model?.id, workspace: tools.describe() };
    let ended = false;
    let exhausted = true;
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
              this.save();
              if (stopped) return this.dispatch({ type: "notice", text: "Stopped. Changes made so far are kept." });
            } else if (event.stop === "time") {
              // The request ran out of time on the server; carry on from its progress.
              next = event.messages;
            } else if (event.stop === "max_tokens") {
              this.dispatch({ type: "notice", text: "The answer was cut off. Ask to continue." });
            } else if (event.stop === "limit") {
              this.dispatch({ type: "notice", text: "Paused after many steps. Send “continue” to go on." });
            } else if (event.stop === "end") {
              ended = true;
            }
          }
        }
        if (!finished) return this.dispatch({ type: "network" });
        if (!next) {
          exhausted = false;
          break;
        }
        request = next;
      }
      if (exhausted) this.dispatch({ type: "notice", text: "Paused after many steps. Send “continue” to go on." });
      if (ended && this.mode === "plan") this.dispatch({ type: "plan_ready", ready: true });
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
      this.save();
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
      const refused = refusedInMode(this.mode, call.name);
      const command = call.name === "run_command" && !refused ? { command: String(call.input.command), commandState: "waiting" as const } : {};
      this.dispatch({ type: "step_start", id, ...toolStep(call.name, call.input), ...command });
      const result = (content: string, ok = true) => {
        results.push({ type: "tool_result", tool_use_id: call.id, content, ...(ok ? {} : { is_error: true }) });
      };
      try {
        const input = call.input;
        if (refused) {
          this.dispatch({ type: "step_end", id, ok: false, detail: "Not in plan mode" });
          result(refused, false);
        } else if (call.name === "search_code") {
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
          result(...(await this.command(id, input, tools.cwd(input.cwd), signal)));
        } else if (call.name === "command_output") {
          const out = await this.background.output(String(input.id), Math.min(60, Number(input.wait_seconds) || 0) * 1000);
          const status = out.running ? "Still running." : `Ended with exit code ${out.code}.`;
          this.dispatch({ type: "step_end", id, ok: true });
          result(`${status}\n${cleanOutput(out.output) || "(no output yet)"}`);
        } else if (call.name === "stop_command") {
          await this.background.stop(String(input.id));
          this.dispatch({ type: "step_end", id, ok: true });
          result("Stopped.");
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
   * run_command: waits for the developer's Run or Skip (unless full access),
   * then runs it with live output; background commands keep running.
   */
  private async command(id: string, input: Record<string, any>, cwd: string, signal: AbortSignal): Promise<[string, boolean]> {
    const run = runsItself(this.mode)
      ? true
      : await new Promise<boolean>((resolve) => {
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
    const command = String(input.command);
    if (input.background) {
      const started = await this.background.start(command, cwd);
      this.dispatch({ type: "command", id, state: "done", output: started.output });
      this.dispatch({ type: "step_end", id, ok: started.running || started.code === 0, detail: started.running ? `Running as ${started.id}` : `Exit code ${started.code}` });
      const status = started.running ? `Started in the background as ${started.id}; still running.` : `It already ended (exit code ${started.code}).`;
      return [`${status}\n${started.output || "(no output yet)"}`, started.running || started.code === 0];
    }
    let latest: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = input.timeout_seconds ? Math.min(600, Math.max(10, Number(input.timeout_seconds))) * 1000 : COMMAND_TIMEOUT_MS;
    const result = await runCommand(command, cwd, {
      signal,
      timeoutMs,
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
    return [describeResult(result, timeoutMs), ok];
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

  /** propose_edit / create_file: queue it, and apply it now when the mode allows. */
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
    if (!appliesItself(this.mode, proposal.needsReview)) {
      return [`Proposed to the developer for review (change ${proposal.id}). Continue with the rest.`, true];
    }
    const applied = await this.applyChange(proposal.id);
    return applied.status === "applied" ? ["Applied.", true] : [`Not applied: ${applied.reason}.`, false];
  }

  /** Applies a queued change; when it implements events, marks them implemented in Hodor. */
  async applyChange(editId: number): Promise<Proposal> {
    if (!this.queue) throw new Error("This change belongs to an earlier session and can't be applied any more.");
    const applied = await this.queue.apply(editId);
    if (applied.status === "applied") await this.markImplemented(applied.eventNames);
    this.save();
    return applied;
  }

  async applyAll(): Promise<void> {
    if (!this.queue) return;
    for (const p of [...this.queue.proposals.values()]) if (p.status === "proposed") await this.applyChange(p.id);
    await this.tree.refresh();
  }

  skip(editId: number): void {
    this.queue?.skip(editId);
    this.save();
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
    this.clear();
    this.changed.dispose();
  }
}
