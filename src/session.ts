// The signed-in state: the Hodor token (kept in VS Code's SecretStorage, which
// uses the OS keychain) and a client that sends it.

import * as os from "os";
import * as vscode from "vscode";
import { HodorClient } from "./api";
import { waitForApproval } from "./login";

const TOKEN_KEY = "hodor.token";

const serverUrl = () => vscode.workspace.getConfiguration("hodor").get<string>("serverUrl") || "https://hodor.optiblack.com";

export class Session implements vscode.Disposable {
  private token: string | undefined;
  private current!: HodorClient;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];

  /** Fires after sign-in, sign-out, an ended session or a server change. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("hodor.serverUrl")) return;
        this.rebuild();
        this.changed.fire();
      })
    );
  }

  async init(): Promise<void> {
    this.token = await this.context.secrets.get(TOKEN_KEY);
    this.rebuild();
    await this.updateContext();
  }

  get client(): HodorClient {
    return this.current;
  }

  isSignedIn(): boolean {
    return Boolean(this.token);
  }

  async signIn(): Promise<void> {
    const start = await this.current.startLogin(`${vscode.env.appName} on ${os.hostname()}`);
    await vscode.env.openExternal(vscode.Uri.parse(start.verificationUrl));
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Approve in your browser — code ${start.userCode}`,
        cancellable: true,
      },
      (_progress, cancel) =>
        waitForApproval(this.current, start, {
          isCancelled: () => cancel.isCancellationRequested,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        })
    );
    if (result.outcome === "approved") {
      await this.setToken(result.token);
      vscode.window.showInformationMessage("Signed in to Hodor.");
    } else if (result.outcome === "denied") {
      vscode.window.showWarningMessage("Sign-in was denied.");
    } else if (result.outcome === "expired") {
      vscode.window.showWarningMessage("Sign-in expired. Try again.");
    }
  }

  async signOut(): Promise<void> {
    // Revoke on Hodor too; signing out locally must work even when offline.
    await this.current.revoke().catch(() => undefined);
    await this.setToken(undefined);
  }

  /** Stores (or clears) the token. Also used by the integration tests. */
  async setToken(token: string | undefined): Promise<void> {
    this.token = token;
    if (token) await this.context.secrets.store(TOKEN_KEY, token);
    else await this.context.secrets.delete(TOKEN_KEY);
    this.rebuild();
    await this.updateContext();
    this.changed.fire();
  }

  private rebuild(): void {
    this.current = new HodorClient({
      serverUrl: serverUrl(),
      token: this.token,
      version: String(this.context.extension.packageJSON.version),
      onUnauthorized: () => void this.ended(),
    });
  }

  private async ended(): Promise<void> {
    if (!this.token) return;
    await this.setToken(undefined);
    vscode.window.showWarningMessage("Your Hodor session ended. Sign in again.");
  }

  private updateContext(): Thenable<unknown> {
    return vscode.commands.executeCommand("setContext", "hodor.signedIn", this.isSignedIn());
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
