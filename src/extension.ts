import * as vscode from "vscode";
import { HodorError } from "./api";
import { Session } from "./session";

/** Runs a command, showing Hodor's message instead of a stack trace when it fails. */
const guarded =
  <A extends unknown[]>(run: (...args: A) => Promise<unknown>) =>
  async (...args: A) => {
    try {
      await run(...args);
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof HodorError ? error.message : `Hodor: ${String(error)}`);
    }
  };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new Session(context);
  context.subscriptions.push(session);
  await session.init();

  context.subscriptions.push(
    vscode.commands.registerCommand("hodor.signIn", guarded(() => session.signIn())),
    vscode.commands.registerCommand("hodor.signOut", guarded(() => session.signOut()))
  );
}

export function deactivate(): void {}
