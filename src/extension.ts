import * as vscode from "vscode";
import { HodorError, Status } from "./api";
import { CodeActions, DetailsPanel } from "./detailsPanel";
import { EventTreeProvider } from "./eventTree";
import { ProjectChoice } from "./projects";
import { Session } from "./session";

/** Context-menu commands get the tree node; others get the event id. */
const eventIdOf = (arg: unknown): string | undefined =>
  typeof arg === "string" ? arg : (arg as { event?: { id?: string } } | undefined)?.event?.id;

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
  const choice = new ProjectChoice(context, session);
  context.subscriptions.push(choice);

  context.subscriptions.push(
    session.onDidChange(() => void choice.restore()),
    vscode.commands.registerCommand("hodor.signIn", guarded(() => session.signIn())),
    vscode.commands.registerCommand(
      "hodor.signOut",
      guarded(async () => {
        await choice.clear();
        await session.signOut();
      })
    ),
    vscode.commands.registerCommand("hodor.pickProject", guarded((id?: string) => choice.pick(id)))
  );

  const tree = new EventTreeProvider(session, choice);
  context.subscriptions.push(
    tree,
    choice.onDidChange(() => void tree.refresh()),
    vscode.commands.registerCommand(
      "hodor.refresh",
      guarded(async () => {
        actions.clear();
        await tree.refresh();
        await details.reload();
      })
    ),
    vscode.commands.registerCommand(
      "hodor.search",
      guarded(async () => {
        const query = await vscode.window.showInputBox({
          title: "Search events",
          prompt: "Matches event names and descriptions",
          value: tree.currentQuery,
        });
        if (query !== undefined) await tree.setQuery(query);
      })
    ),
    vscode.commands.registerCommand("hodor.clearSearch", guarded(() => tree.setQuery("")))
  );

  const actions = new CodeActions(context, session, choice);
  const details = new DetailsPanel(session, choice, actions, async (eventId: string, status: Status) => {
    await vscode.commands.executeCommand("hodor.setStatus", eventId, status);
  }
  );
  context.subscriptions.push(
    details,
    choice.onDidChange(() => actions.clear()),
    vscode.commands.registerCommand(
      "hodor.openEvent",
      guarded(async (arg?: unknown) => {
        const id = eventIdOf(arg);
        if (id) await details.show(id);
      })
    ),
    vscode.commands.registerCommand(
      "hodor.copyCode",
      guarded(async (arg?: unknown, language?: string) => {
        const event = tree.getEvent(eventIdOf(arg) || "");
        if (event) await actions.copyEvent(event.name, language);
      })
    ),
    vscode.commands.registerCommand("hodor.openInHodor", guarded(async () => actions.openInHodor()))
  );

  await choice.restore();
}

export function deactivate(): void {}
