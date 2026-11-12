// The "Chat" view in the Hodor sidebar: shows the controller's state and
// passes the developer's clicks back to it.

import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { ProjectChoice } from "../projects";
import { Session } from "../session";
import { ChatController } from "./controller";
import { renderChatPage } from "./html";
import { parseMarkdown } from "../markdown";

type Mode = "signedOut" | "noProject" | "noFolder" | "ready";

type Message =
  | { type: "ready" | "stop" | "retry" | "continue" | "settings" | "applyAll" | "signIn" | "pickProject" }
  | { type: "send"; text: string }
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
      session.onDidChange(() => this.post()),
      choice.onDidChange(() => {
        chat.reset();
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
    void this.view?.webview.postMessage({ mode: this.mode(), state: { ...state, items } });
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
          return this.post();
        case "send":
          return await this.chat.send(message.text);
        case "stop":
          return this.chat.stop();
        case "retry":
        case "continue":
          return await this.chat.resume();
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
        case "settings": {
          const project = this.choice.project;
          if (project) await vscode.env.openExternal(vscode.Uri.parse(`${this.session.client.serverUrl}/edit/organization/${project.id}`));
          return;
        }
        case "open": {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) return;
          const uri = vscode.Uri.joinPath(folder.uri, message.path);
          // The path came from the AI: only open files inside the project.
          if (!uri.fsPath.startsWith(folder.uri.fsPath + path.sep)) return;
          const line = Math.max(0, (message.line ?? 1) - 1);
          await vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, 0, line, 0), preview: true });
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
