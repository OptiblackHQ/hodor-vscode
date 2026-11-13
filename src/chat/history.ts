// Saved chats, like Claude Code's history: one JSON file per chat in the
// extension's storage for this workspace. Only plain files (no VS Code API),
// so it is unit tested with a temporary folder.

import * as fs from "fs";
import * as path from "path";
import { ChatMessage } from "../aiClient";
import { Item } from "./state";

export const MAX_CHATS = 50;

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId: string;
  model: string;
  /** The conversation as Hodor returned it (what the AI sees). */
  messages: ChatMessage[];
  /** What the chat showed (what the developer sees). */
  items: Item[];
}

export type ChatSummary = Pick<ChatRecord, "id" | "title" | "updatedAt" | "projectId" | "model">;

export const newChatId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The first line of the first message, shortened. */
export const titleFor = (items: Item[]): string => {
  const first = items.find((i) => i.kind === "user");
  const text = (first?.text || "New chat").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || "New chat";
};

/**
 * A chat as reopened: changes it proposed can no longer be applied (the code
 * may have moved on), and commands that were waiting won't run.
 */
export const reopened = (items: Item[]): Item[] =>
  items.map((item) => {
    if (item.kind !== "step") return item;
    const next = { ...item };
    if (next.status === "running") next.status = "error";
    if (next.editStatus === "proposed") next.editStatus = "expired";
    if (next.commandState === "waiting" || next.commandState === "running") next.commandState = "skipped";
    return next;
  });

const SAFE_ID = /^[a-z0-9-]{3,40}$/;

export class HistoryStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error("Invalid chat id.");
    return path.join(this.dir, `${id}.json`);
  }

  save(record: ChatRecord): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file(record.id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, this.file(record.id));
    this.prune();
  }

  load(id: string): ChatRecord | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), "utf8")) as ChatRecord;
    } catch {
      return null;
    }
  }

  delete(id: string): void {
    try {
      fs.unlinkSync(this.file(id));
    } catch {
      // already gone
    }
  }

  /** Newest first; reads only each file's summary fields. */
  list(): ChatSummary[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const out: ChatSummary[] = [];
    for (const name of names) {
      const record = this.load(name.slice(0, -5));
      if (record) out.push({ id: record.id, title: record.title, updatedAt: record.updatedAt, projectId: record.projectId, model: record.model });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Keeps the newest MAX_CHATS. */
  private prune(): void {
    for (const old of this.list().slice(MAX_CHATS)) this.delete(old.id);
  }
}
