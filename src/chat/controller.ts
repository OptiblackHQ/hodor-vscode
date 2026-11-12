// Runs the chat: posts the conversation to Hodor, shows progress as it
// streams, runs the repo tools Claude asks for on this machine, and posts the
// results until Claude is done. Applied edits mark their events implemented.

import * as vscode from "vscode";
import { aiTurn, ChatMessage, PendingTool, ToolResult } from "../aiClient";
import { HodorError } from "../api";
import { EditQueue, Proposal } from "../edits";
import { EventTreeProvider } from "../eventTree";
import { ProjectChoice } from "../projects";
import { RepoTools } from "../repoTools";
import { Session } from "../session";
import { changeStatus } from "../status";
import { Action, ChatState, initialState, reduce, toolStep } from "./state";

const MAX_REQUESTS = 40;

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

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.state.running) return;
    if (!(await this.ensureTools())) {
      vscode.window.showWarningMessage("Open the project folder first: the chat works on the open project.");
      return;
    }
    this.dispatch({ type: "user", text: message });
    await this.run([...this.history, { role: "user", content: message }]);
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
    this.history = [];
    this.lastRequest = null;
    this.tools = null;
    this.dispatch({ type: "reset" });
  }

  private async run(messages: ChatMessage[]): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    this.dispatch({ type: "running", running: true });
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let request = messages;
    try {
      for (let n = 0; n < MAX_REQUESTS; n++) {
        this.lastRequest = request;
        let finished = false;
        let next: ChatMessage[] | null = null;
        for await (const event of aiTurn(this.session.client, project.id, request, signal)) {
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
              const results = await this.runPending(event.pending, signal);
              next = [...event.messages, { role: "user", content: [...event.serverResults, ...results] }];
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
        return this.dispatch({ type: "error", code, message: error.message });
      }
      this.dispatch({ type: "network" });
    } finally {
      if (this.state.running) this.dispatch({ type: "running", running: false });
      await this.tree.refresh();
    }
  }

  private async runPending(pending: PendingTool[], signal: AbortSignal): Promise<ToolResult[]> {
    const tools = (await this.ensureTools())!;
    const results: ToolResult[] = [];
    for (const call of pending) {
      if (signal.aborted) throw new Error("aborted");
      const id = `r${++this.stepCount}`;
      this.dispatch({ type: "step_start", id, ...toolStep(call.name, call.input) });
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
        } else {
          result(...(await this.change(id, call)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.dispatch({ type: "step_end", id, ok: false, detail: message });
        result(message, false);
      }
    }
    return results;
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
    if (!this.autoApply()) {
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
    this.queue?.dispose();
    this.changed.dispose();
  }
}
