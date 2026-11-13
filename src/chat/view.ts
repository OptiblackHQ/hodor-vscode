// The "Chat" view in the Hodor sidebar: shows the controller's state and
// passes the developer's clicks back to it.

import * as crypto from "crypto";
import * as vscode from "vscode";
import { ProjectChoice } from "../projects";
import { Session } from "../session";
import { ChatController } from "./controller";
import { renderChatPage } from "./html";
import { parseMarkdown } from "../markdown";
import { titleFor } from "./history";
import { isMode, MODES } from "./modes";
import { shortLabel } from "./models";

type Mode = "signedOut" | "noProject" | "noFolder" | "ready";

type Message =
  | { type: "ready" | "stop" | "retry" | "continue" | "useClaude" | "settings" | "applyAll" | "signIn" | "pickProject" | "newChat" | "listChats" | "approvePlan" }
  | { type: "openChat" | "deleteChat"; id: string }
  | { type: "setMode"; mode: string }
  | { type: "setModel"; model: string }
  | { type: "link"; href: string }
  | { type: "send"; text: string; images?: string[] }
  | { type: "setProvider"; provider: "claude" | "gemini" }
  | { type: "apply" | "skip" | "diff"; id: number }
  | { type: "runCommand" | "skipCommand"; id: string }
  | { type: "copy"; text: string }
  | { type: "open"; path: string; line?: number };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly session: Session,
    private readonly choice: ProjectChoice,
    private readonly chat: ChatController
  ) {
    this.disposables.push(
      chat.onDidChange(() => this.post()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("hodor.ai")) this.post();
      }),
      session.onDidChange(() => {
        void chat.loadProviders();
        this.post();
      }),
      choice.onDidChange(() => {
        chat.reset();
        void chat.loadProviders();
        this.post();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        chat.reset();
        this.post();
      })
    );
  }

  private mode(): Mode {
    if (!this.session.isSignedIn()) return "signedOut";
    if (!this.choice.project) return "noProject";
    if (!vscode.workspace.workspaceFolders?.length) return "noFolder";
    return "ready";
  }

  private post(): void {
    const state = this.chat.current;
    // Answers go to the page as parsed Markdown blocks; the page draws them as text.
    const items = state.items.map((item) => (item.kind === "assistant" ? { ...item, blocks: parseMarkdown(item.text) } : item));
    const model = this.chat.model;
    const ai = {
      provider: this.chat.provider,
      available: this.chat.providers,
      model: model?.id,
      models: this.chat.models.map((m) => ({ ...m, short: shortLabel(m) })),
      mode: this.chat.mode,
      modes: MODES,
    };
    const history = { chats: this.chat.listChats(), current: this.chat.chatIdNow };
    const title = state.items.length ? titleFor(state.items) : "New chat";
    void this.view?.webview.postMessage({ mode: this.mode(), state: { ...state, items }, ai, history, title });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderChatPage({ nonce: crypto.randomBytes(16).toString("base64"), cspSource: view.webview.cspSource });
    view.webview.onDidReceiveMessage((message: Message) => void this.handle(message), undefined, this.disposables);
    view.onDidDispose(() => (this.view = undefined), undefined, this.disposables);
  }

  private async handle(message: Message): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          void this.chat.loadProviders();
          return this.post();
        case "send":
          return await this.chat.send(message.text, Array.isArray(message.images) ? message.images : []);
        case "setProvider":
          return await this.chat.setProvider(message.provider === "gemini" ? "gemini" : "claude");
        case "setModel":
          return await this.chat.setModel(String(message.model));
        case "setMode":
          if (isMode(message.mode)) await this.chat.setMode(message.mode);
          return this.post();
        case "approvePlan":
          return await this.chat.approvePlan();
        case "newChat":
          return this.chat.newChat();
        case "listChats":
          return this.post();
        case "openChat":
          if (!this.chat.openChat(String(message.id))) vscode.window.showWarningMessage("Hodor: finish or stop the current reply first.");
          return this.post();
        case "deleteChat":
          this.chat.deleteChat(String(message.id));
          return this.post();
        case "link": {
          // Links from answers: web pages only.
          const href = String(message.href);
          if (/^https?:\/\//.test(href)) await vscode.env.openExternal(vscode.Uri.parse(href));
          return;
        }
        case "stop":
          return this.chat.stop();
        case "retry":
        case "continue":
          return await this.chat.resume();
        case "useClaude":
          return await this.chat.continueWithClaude();
        case "apply":
          await this.chat.applyChange(message.id);
          return;
        case "applyAll":
          return await this.chat.applyAll();
        case "skip":
          return this.chat.skip(message.id);
        case "diff":
          return await this.chat.diff(message.id);
        case "runCommand":
          return this.chat.decide(message.id, true);
        case "skipCommand":
          return this.chat.decide(message.id, false);
        case "copy":
          await vscode.env.clipboard.writeText(String(message.text));
          vscode.window.setStatusBarMessage("Hodor: copied", 2000);
          return;
        case "signIn":
          await vscode.commands.executeCommand("hodor.signIn");
          return;
        case "pickProject":
          await vscode.commands.executeCommand("hodor.pickProject");
          return;
        case "settings":
          // Personal Claude / Gemini keys live on the MCP / CLI page.
          await vscode.env.openExternal(vscode.Uri.parse(`${this.session.client.serverUrl}/mcp`));
          return;
        case "open": {
          // The path came from the AI: only files inside the open folders, through the guard.
          const abs = await this.chat.fileFor(String(message.path));
          if (!abs) return;
          const line = Math.max(0, (message.line ?? 1) - 1);
          await vscode.window.showTextDocument(vscode.Uri.file(abs), { selection: new vscode.Range(line, 0, line, 0), preview: true });
          return;
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Hodor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
