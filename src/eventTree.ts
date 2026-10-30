// The "Events" view: the picked product's events grouped by status.

import * as vscode from "vscode";
import { EventSummary, HodorError } from "./api";
import { EventGroup, groupEvents } from "./eventGroups";
import { ProjectChoice } from "./projects";
import { Session } from "./session";

type Node = { kind: "group"; group: EventGroup } | { kind: "event"; event: EventSummary };

export class EventTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private events: EventSummary[] = [];
  private query = "";
  private loadedFor: string | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly view: vscode.TreeView<Node>;

  constructor(private readonly session: Session, private readonly choice: ProjectChoice) {
    this.view = vscode.window.createTreeView("hodor.events", { treeDataProvider: this, showCollapseAll: true });
  }

  getEvent(id: string): EventSummary | undefined {
    return this.events.find((e) => e.id === id);
  }

  async setQuery(query: string): Promise<void> {
    this.query = query.trim();
    await vscode.commands.executeCommand("setContext", "hodor.searching", Boolean(this.query));
    this.render();
  }

  get currentQuery(): string {
    return this.query;
  }

  /** Reloads the events from Hodor. */
  async refresh(): Promise<void> {
    const project = this.choice.project;
    if (!project || !this.session.isSignedIn()) {
      this.events = [];
      this.loadedFor = undefined;
      return this.render();
    }
    // A slower answer for a product picked earlier must not replace this one.
    const stale = () => this.choice.project?.id !== project.id;
    try {
      const result = await this.session.client.project(project.id);
      if (stale()) return;
      this.events = result.events;
      this.loadedFor = project.id;
      this.render();
    } catch (error) {
      if (stale()) return;
      this.events = [];
      this.render();
      const message = error instanceof HodorError ? error.message : String(error);
      this.view.message = message;
      if (!(error instanceof HodorError && error.status === 401)) {
        vscode.window.showErrorMessage(message, "Retry").then((choice) => {
          if (choice === "Retry") void this.refresh();
        });
      }
    }
  }

  private render(): void {
    const project = this.choice.project;
    this.view.description = project ? `${project.name}${this.query ? ` · "${this.query}"` : ""}` : undefined;
    if (!project || this.loadedFor !== project.id) this.view.message = undefined;
    else if (!this.events.length) this.view.message = "No events";
    else if (!groupEvents(this.events, this.query).length) this.view.message = `No events match "${this.query}"`;
    else this.view.message = undefined;
    this.changed.fire();
  }

  getChildren(node?: Node): Node[] {
    if (!node) return groupEvents(this.events, this.query).map((group) => ({ kind: "group", group }));
    return node.kind === "group" ? node.group.events.map((event) => ({ kind: "event", event })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        `${node.group.label} (${node.group.events.length})`,
        // Done work starts folded so the open work stands out.
        node.group.status === "implemented"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `group:${node.group.status}`;
      return item;
    }
    const { event } = node;
    const item = new vscode.TreeItem(event.name, vscode.TreeItemCollapsibleState.None);
    item.id = `event:${event.id}`;
    item.contextValue = "event";
    item.description = event.platform.join(", ");
    item.tooltip = event.description || undefined;
    item.iconPath = new vscode.ThemeIcon(event.status === "implemented" ? "pass" : "circle-outline");
    item.command = { command: "hodor.openEvent", title: "Open event", arguments: [event.id] };
    return item;
  }

  dispose(): void {
    this.view.dispose();
    this.changed.dispose();
  }
}
