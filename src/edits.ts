// Changes the AI wants to make: planned purely (planEdit / planCreate), then
// either applied right away (auto-apply) or kept for the developer to review.
// An edit is refused when its file changed since the AI read it.

import * as vscode from "vscode";
import { Plan, planCreate, planEdit } from "./editPlan";
import { needsReview } from "./repoGuard";
import { hashText, RepoTools } from "./repoTools";

export interface Proposal {
  id: number;
  kind: "edit" | "create";
  rel: string;
  abs: string;
  oldText?: string;
  newText: string;
  eventNames: string[];
  summary: string;
  status: "proposed" | "applied" | "skipped" | "failed";
  reason?: string;
  /** Build or config file: never applied without the developer's review. */
  needsReview: boolean;
}

const PROPOSED_SCHEME = "hodor-proposed";

export class EditQueue implements vscode.Disposable {
  private nextId = 1;
  readonly proposals = new Map<number, Proposal>();
  private readonly previews = new Map<string, string>();
  private readonly registration: vscode.Disposable;
  private readonly changed = new vscode.EventEmitter<Proposal>();
  readonly onDidChange = this.changed.event;

  constructor(private tools: RepoTools) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, {
      provideTextDocumentContent: (uri) => this.previews.get(uri.query) ?? "",
    });
  }

  /** The chat changes project (new workspace) by giving a new RepoTools. */
  useTools(tools: RepoTools): void {
    this.tools = tools;
  }

  /** Checks an edit or new file and queues it. Returns the proposal, or a reason it can't be made. */
  propose(input: Omit<Proposal, "id" | "abs" | "rel" | "status" | "needsReview"> & { path: string }): Proposal | string {
    const resolved = this.tools.guard.writable(input.path);
    if (!resolved.ok) return `Can't change ${input.path}: ${resolved.reason}.`;
    if (input.kind === "edit" && !this.tools.readHashes.has(resolved.rel)) {
      return `Read ${resolved.rel} with read_file before editing it.`;
    }
    const proposal: Proposal = {
      ...input,
      id: this.nextId++,
      rel: resolved.rel,
      abs: resolved.abs,
      status: "proposed",
      needsReview: needsReview(resolved.rel),
    };
    this.proposals.set(proposal.id, proposal);
    this.changed.fire(proposal);
    return proposal;
  }

  private async plan(p: Proposal): Promise<Plan> {
    if (p.kind === "create") {
      let exists = true;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(p.abs));
      } catch {
        exists = false;
      }
      const ok = planCreate(exists);
      return ok.ok ? { ok: true, next: p.newText } : ok;
    }
    const current = await this.tools.readText(p.abs).catch(() => null);
    if (current === null) return { ok: false, reason: "the file no longer exists" };
    if (this.tools.readHashes.get(p.rel) !== hashText(current)) return { ok: false, reason: "the file changed since it was read" };
    return planEdit(current, p.oldText || "", p.newText);
  }

  /** Writes the change and saves the file. Returns the proposal with its new status. */
  async apply(id: number): Promise<Proposal> {
    const p = this.proposals.get(id);
    if (!p || p.status !== "proposed") throw new Error("This change was already handled.");
    const plan = await this.plan(p);
    if (!plan.ok) {
      p.status = "failed";
      p.reason = plan.reason;
      this.changed.fire(p);
      return p;
    }
    const uri = vscode.Uri.file(p.abs);
    const edit = new vscode.WorkspaceEdit();
    if (p.kind === "create") {
      edit.createFile(uri, { ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), plan.next);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), plan.next);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      p.status = "failed";
      p.reason = "the editor refused the change";
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();
      // Later edits to the same file build on this one.
      this.tools.readHashes.set(p.rel, hashText(doc.getText()));
      p.status = "applied";
    }
    this.changed.fire(p);
    return p;
  }

  skip(id: number): void {
    const p = this.proposals.get(id);
    if (!p || p.status !== "proposed") return;
    p.status = "skipped";
    this.changed.fire(p);
  }

  /** Opens a side-by-side view of the change. */
  async diff(id: number): Promise<void> {
    const p = this.proposals.get(id);
    if (!p) return;
    const plan = await this.plan(p);
    if (!plan.ok) {
      vscode.window.showWarningMessage(`Can't preview ${p.rel}: ${plan.reason}.`);
      return;
    }
    const key = `${p.id}-${Date.now()}`;
    this.previews.set(key, plan.next);
    const right = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${p.rel}`, query: key });
    const left = p.kind === "create" ? vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: `/${p.rel}`, query: "empty" }) : vscode.Uri.file(p.abs);
    await vscode.commands.executeCommand("vscode.diff", left, right, `${p.rel} (proposed by Hodor)`);
  }

  dispose(): void {
    this.registration.dispose();
    this.changed.dispose();
  }
}
