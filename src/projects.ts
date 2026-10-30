// Which Hodor product this workspace shows. Remembered per workspace; the
// default comes from the repo's .hodor.json (written by the Hodor CLI).

import * as vscode from "vscode";
import { Project } from "./api";
import { readRepoProject } from "./repoProject";
import { Session } from "./session";

const STATE_KEY = "hodor.project";

type Saved = { id: string; name: string };

export class ProjectChoice implements vscode.Disposable {
  private current: Project | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: Session) {}

  get project(): Project | undefined {
    return this.current;
  }

  /** Startup and after sign-in: the saved choice, else .hodor.json, else none. Never shows an error. */
  async restore(): Promise<void> {
    if (!this.session.isSignedIn()) return this.set(undefined, false);
    const saved = this.context.workspaceState.get<Saved>(STATE_KEY);
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    const wanted = saved?.id || (await readRepoProject(folders));
    if (!wanted) return this.set(undefined, false);
    let projects;
    try {
      projects = await this.session.client.projects();
    } catch {
      // Offline at startup: keep the saved choice for next time.
      return this.set(undefined, false);
    }
    const found = projects.find((p) => p.id === wanted);
    if (found) return this.set(found, Boolean(saved));
    if (saved) vscode.window.showWarningMessage(`You no longer have access to ${saved.name}. Pick another product.`);
    return this.set(undefined, Boolean(saved));
  }

  /** Shows a product list, or picks `id` directly (used by tests). */
  async pick(id?: string): Promise<void> {
    const projects = await this.session.client.projects();
    if (!projects.length) {
      vscode.window.showInformationMessage("This sign-in can't reach any products. Create one in Hodor, or sign in again and allow it.");
      return;
    }
    let chosen = id ? projects.find((p) => p.id === id) : undefined;
    if (!id) {
      const item = await vscode.window.showQuickPick(
        projects.map((p) => ({
          label: p.name,
          description: p.id === this.current?.id ? "(current)" : p.description || "",
          detail: p.total_events === undefined ? undefined : `${p.total_events} events · ${p.analytics_provider}`,
          project: p,
        })),
        { title: "Pick the Hodor product for this workspace", matchOnDescription: true }
      );
      chosen = item?.project;
    }
    if (chosen) await this.set(chosen, true);
  }

  async clear(): Promise<void> {
    await this.set(undefined, true);
  }

  private async set(project: Project | undefined, remember: boolean): Promise<void> {
    this.current = project;
    if (remember) {
      const saved: Saved | undefined = project && { id: project.id, name: project.name };
      await this.context.workspaceState.update(STATE_KEY, saved);
    }
    await vscode.commands.executeCommand("setContext", "hodor.hasProject", Boolean(project));
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}
