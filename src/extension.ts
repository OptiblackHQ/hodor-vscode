import * as vscode from "vscode";
import { RepoTools } from "./repoTools";
import { HodorError, Status, STATUSES } from "./api";
import { statusLabel } from "./eventGroups";
import { CodeActions, DetailsPanel } from "./detailsPanel";
import { EventTreeProvider } from "./eventTree";
import { ProjectChoice } from "./projects";
import { Session } from "./session";
import { changeStatus } from "./status";
import { ChatController } from "./chat/controller";
import { HistoryStore } from "./chat/history";
import { ChatViewProvider } from "./chat/view";

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

export async function activate(context: vscode.ExtensionContext): Promise<unknown> {
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
    choice.onDidChange(() => {
      actions.clear();
      details.closeIfOtherProject();
    }),
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
    vscode.commands.registerCommand("hodor.openInHodor", guarded(async () => actions.openInHodor())),
    vscode.commands.registerCommand(
      "hodor.setStatus",
      guarded(async (arg?: unknown, wanted?: Status) => {
        const project = choice.project;
        if (!project) {
          vscode.window.showWarningMessage("Pick a Hodor product first.");
          return;
        }
        const id = eventIdOf(arg) || "";
        const event = tree.getEvent(id) || details.shownEvent(id);
        if (!event) {
          vscode.window.showWarningMessage("This event isn't loaded. Refresh and try again.");
          return;
        }
        const status =
          wanted ??
          (
            await vscode.window.showQuickPick(
              STATUSES.map((s) => ({ label: statusLabel(s), description: s === event.status ? "(current)" : "", status: s })),
              { title: `Status of ${event.name}` }
            )
          )?.status;
        if (!status || status === event.status) return;
        const result = await changeStatus(session.client, project.id, event, status);
        if (result.ok) vscode.window.showInformationMessage(`${event.name}: ${statusLabel(status)}`);
        else vscode.window.showWarningMessage(result.message);
        if (result.ok || result.reload) await tree.refresh();
        // Also puts the panel's status select back when the change failed.
        if (details.eventId === event.id) await details.reload();
      })
    )
  );

  // Saved chats live in this workspace's storage (or the global one without a workspace).
  const historyDir = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, "chats").fsPath;
  const chat = new ChatController(session, choice, tree, new HistoryStore(historyDir));
  const chatView = new ChatViewProvider(session, choice, chat);
  context.subscriptions.push(
    chat,
    chatView,
    vscode.window.registerWebviewViewProvider("hodor.chat", chatView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("hodor.newChat", () => chat.newChat())
  );

  await choice.restore();

  // Only for the integration tests: sign in with a token and reach the parts they check.
  if (process.env.HODOR_TEST === "1") {
    context.subscriptions.push(
      vscode.commands.registerCommand("hodor._setTokenForTests", (token: string) => session.setToken(token))
    );
    return { session, choice, tree, chat, repoTools: () => RepoTools.forWorkspace() };
  }
  return undefined;
}

export function deactivate(): void {}
