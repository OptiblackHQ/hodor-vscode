// Runs the AI's repo tools on the developer's machine: search, list and read,
// inside the open project and through the guard. Files open in the editor are
// read from the editor, so unsaved changes count.

import * as crypto from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";
import { createGuard, Guard, matchLines, SKIPPED_DIRS } from "./repoGuard";

const MAX_SEARCH_FILES = 3000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_MATCHES = 60;
const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 40 * 1024;
const MAX_LIST = 200;

export const hashText = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

export class RepoTools {
  /** sha256 of each file as the AI last read it, to refuse edits on files changed since. */
  readonly readHashes = new Map<string, string>();

  private constructor(readonly root: vscode.Uri, readonly guard: Guard) {}

  /** For the first workspace folder; null when no folder is open. */
  static async forWorkspace(): Promise<RepoTools | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;
    let gitignore = "";
    try {
      gitignore = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ".gitignore"))).toString("utf8");
    } catch {
      // no .gitignore
    }
    return new RepoTools(folder.uri, createGuard(folder.uri.fsPath, gitignore, fs.realpathSync));
  }

  /** The file's text, from the editor when it is open there. */
  async readText(abs: string): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (open) return open.getText();
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(abs))).toString("utf8");
  }

  async search(query: string, glob?: string): Promise<string> {
    const exclude = `**/{${SKIPPED_DIRS.join(",")}}/**`;
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.root, glob || "**/*"), exclude, MAX_SEARCH_FILES);
    const lines: string[] = [];
    for (const uri of files.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
      if (lines.length >= MAX_MATCHES) break;
      const resolved = this.guard.resolve(vscode.workspace.asRelativePath(uri, false));
      if (!resolved.ok) continue;
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) continue;
        const text = await this.readText(uri.fsPath);
        if (text.includes("\0")) continue; // binary
        for (const m of matchLines(text, query, MAX_MATCHES - lines.length)) lines.push(`${resolved.rel}:${m.line}: ${m.text}`);
      } catch {
        // unreadable file: skip
      }
    }
    if (!lines.length) return "No matches.";
    return lines.join("\n") + (lines.length >= MAX_MATCHES ? `\n(first ${MAX_MATCHES} matches; search for something more specific)` : "");
  }

  async list(dir = ""): Promise<string> {
    const resolved = this.guard.resolve(dir);
    if (!resolved.ok) throw new Error(`Can't list ${dir}: ${resolved.reason}.`);
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(resolved.abs));
    const shown = entries
      .map(([name, type]) => ({ rel: resolved.rel ? `${resolved.rel}/${name}` : name, dir: (type & vscode.FileType.Directory) !== 0 }))
      .filter((e) => this.guard.resolve(e.rel).ok)
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.rel.localeCompare(b.rel));
    const lines = shown.slice(0, MAX_LIST).map((e) => (e.dir ? `${e.rel}/` : e.rel));
    if (shown.length > MAX_LIST) lines.push(`(${shown.length - MAX_LIST} more)`);
    return lines.join("\n") || "(empty folder)";
  }

  async read(file: string, startLine = 1, endLine?: number): Promise<{ text: string; rel: string; from: number; to: number }> {
    const resolved = this.guard.resolve(file);
    if (!resolved.ok) throw new Error(`Can't read ${file}: ${resolved.reason}.`);
    let content: string;
    try {
      content = await this.readText(resolved.abs);
    } catch {
      throw new Error(`${resolved.rel} doesn't exist.`);
    }
    this.readHashes.set(resolved.rel, hashText(content));
    const all = content.split(/\r?\n/);
    const from = Math.min(Math.max(1, startLine), Math.max(1, all.length));
    let to = Math.min(endLine ?? from + MAX_READ_LINES - 1, from + MAX_READ_LINES - 1, all.length);
    const out: string[] = [];
    let bytes = 0;
    for (let n = from; n <= to; n++) {
      const line = `${n}\t${all[n - 1]}`;
      bytes += line.length + 1;
      if (bytes > MAX_READ_BYTES) {
        to = n - 1;
        break;
      }
      out.push(line);
    }
    const more = to < all.length ? `\n(lines ${from}–${to} of ${all.length}; read more with start_line ${to + 1})` : "";
    return { text: `${resolved.rel} (line number, tab, text):\n${out.join("\n")}${more}`, rel: resolved.rel, from, to };
  }
}
