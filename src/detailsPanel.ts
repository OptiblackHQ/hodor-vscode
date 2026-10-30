// One editor-side panel that shows the event picked in the tree, and the
// copy-code actions that also run from the tree's context menu.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { CodeResult, EventDetails, HodorError, Status } from "./api";
import { renderDetails } from "./detailsHtml";
import { ProjectChoice } from "./projects";
import { Session } from "./session";
import { eventSnippet, languageLabel } from "./snippet";

const LANGUAGE_KEY = "hodor.language";

type Message = { type: "copy" | "copyFile" | "language"; language: string } | { type: "status"; status: Status } | { type: "open" };

export class CodeActions {
  private cache = new Map<string, Promise<CodeResult>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: Session,
    private readonly choice: ProjectChoice
  ) {}

  /** Forgets generated code, e.g. after a refresh. */
  clear(): void {
    this.cache.clear();
  }

  /** The last language used, if this product has it; else the product's first language. */
  defaultLanguage(): string {
    const languages = this.choice.project?.languages || [];
    const last = this.context.globalState.get<string>(LANGUAGE_KEY);
    return last && languages.includes(last) ? last : languages[0] || "javascript";
  }

  rememberLanguage(language: string): Thenable<void> {
    return this.context.globalState.update(LANGUAGE_KEY, language);
  }

  private code(projectId: string, language: string): Promise<CodeResult> {
    const key = `${projectId}:${language}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.session.client.code(projectId, language);
      pending.catch(() => this.cache.delete(key));
      this.cache.set(key, pending);
    }
    return pending;
  }

  async copyEvent(eventName: string, language = this.defaultLanguage()): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    await this.rememberLanguage(language);
    const code = await this.code(project.id, language);
    const snippet = eventSnippet(code, eventName);
    if (!snippet) {
      vscode.window.showWarningMessage("This event isn't in the generated code. Refresh and try again.");
      return;
    }
    await vscode.env.clipboard.writeText(snippet);
    const fn = code.functions.find((f) => f.eventName === eventName)!;
    vscode.window.showInformationMessage(`Copied ${fn.functionName} (${languageLabel(language)}).`);
  }

  async copyFile(language = this.defaultLanguage()): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    await this.rememberLanguage(language);
    const code = await this.code(project.id, language);
    await vscode.env.clipboard.writeText(code.file);
    vscode.window.showInformationMessage(`Copied ${code.filename}. Install: ${code.install}`);
  }

  openInHodor(): Thenable<boolean> | undefined {
    const project = this.choice.project;
    if (!project) return undefined;
    return vscode.env.openExternal(vscode.Uri.parse(`${this.session.client.serverUrl}/dashboard/${project.id}`));
  }
}

export class DetailsPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private event: EventDetails | undefined;

  constructor(
    private readonly session: Session,
    private readonly choice: ProjectChoice,
    private readonly actions: CodeActions,
    /** Changes an event's status (shared with the tree's context menu). */
    private readonly setStatus: (eventId: string, status: Status) => Promise<void>
  ) {}

  get eventId(): string | undefined {
    return this.panel ? this.event?.id : undefined;
  }

  async show(eventId: string): Promise<void> {
    const project = this.choice.project;
    if (!project) return;
    this.event = await this.session.client.event(project.id, eventId);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("hodor.event", this.event.name, vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((message: Message) => void this.handle(message));
    }
    this.panel.title = this.event.name;
    this.render();
    this.panel.reveal(undefined, true);
  }

  /** Reloads the open event, if any (after a status change or refresh). */
  async reload(): Promise<void> {
    if (!this.panel || !this.event) return;
    try {
      await this.show(this.event.id);
    } catch (error) {
      // The event was deleted or is out of reach now.
      if (error instanceof HodorError && error.status === 404) this.panel.dispose();
      else throw error;
    }
  }

  private render(): void {
    if (!this.panel || !this.event) return;
    const languages = (this.choice.project?.languages || []).map((id) => ({ id, label: languageLabel(id) }));
    this.panel.webview.html = renderDetails(this.event, {
      languages,
      selectedLanguage: this.actions.defaultLanguage(),
      nonce: crypto.randomBytes(16).toString("base64"),
      cspSource: this.panel.webview.cspSource,
    });
  }

  private async handle(message: Message): Promise<void> {
    const event = this.event;
    if (!event) return;
    try {
      if (message.type === "copy") await this.actions.copyEvent(event.name, message.language);
      else if (message.type === "copyFile") await this.actions.copyFile(message.language);
      else if (message.type === "language") await this.actions.rememberLanguage(message.language);
      else if (message.type === "open") await this.actions.openInHodor();
      else if (message.type === "status" && message.status !== event.status) await this.setStatus(event.id, message.status);
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof HodorError ? error.message : `Hodor: ${String(error)}`);
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
