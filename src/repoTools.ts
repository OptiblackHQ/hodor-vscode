// Runs the AI's repo tools on the developer's machine: search, list and read,
// inside the folders open in the editor and through the guard. Files open in
// the editor are read from the editor, so unsaved changes count.
//
// Several repos work two ways: one parent folder holding them (paths like
// "shop/src/app.ts" are just folders), or several folders added to the
// workspace (each path starts with the folder's name).

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createGuard, folderNames, matchLines, SKIPPED_DIRS, workspaceGuard, WorkspaceGuard, WorkspaceRoot } from "./repoGuard";

const MAX_SEARCH_FILES = 15000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_MATCHES = 60;
const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 40 * 1024;
const MAX_LIST = 200;
const MAX_PROBLEMS = 100;
const READ_IN_PARALLEL = 48;
const MAX_REPOS_DESCRIBED = 40;

// Files whose bytes are never text worth searching.
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|7z|rar|jar|war|class|so|dylib|dll|exe|bin|wasm|mp[34]|mov|avi|webm|ogg|wav|flac|ttf|otf|woff2?|eot|psd|sketch|fig|lock|pyc|o|a)$/i;

// Marker files that tell the AI which language a repo uses.
const MARKERS: [string, string][] = [
  ["tsconfig.json", "TypeScript"],
  ["package.json", "Node/JavaScript"],
  ["go.mod", "Go"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["setup.py", "Python"],
  ["pubspec.yaml", "Flutter/Dart"],
  ["Podfile", "iOS"],
  ["Package.swift", "Swift"],
  ["build.gradle", "Android/JVM"],
  ["build.gradle.kts", "Android/Kotlin"],
  ["pom.xml", "Java"],
  ["Gemfile", "Ruby"],
  ["composer.json", "PHP"],
  ["Cargo.toml", "Rust"],
];

export const hashText = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

const exists = (p: string) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const readOrNull = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export class RepoTools {
  /** sha256 of each file as the AI last read it, to refuse edits on files changed since. */
  readonly readHashes = new Map<string, string>();

  private constructor(readonly guard: WorkspaceGuard) {}

  /** For every open workspace folder; null when none is open. */
  static async forWorkspace(): Promise<RepoTools | null> {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) return null;
    const names = folderNames(folders.map((f) => f.uri.fsPath));
    const roots: WorkspaceRoot[] = folders.map((folder, i) => {
      const root = folder.uri.fsPath;
      const rules = [readOrNull(path.join(root, ".gitignore")), readOrNull(path.join(root, ".git", "info", "exclude"))];
      // Repos inside the folder have their own .gitignore (and .git/info/exclude).
      const nestedRules = (dir: string) => {
        if (dir === root) return null;
        const own = [readOrNull(path.join(dir, ".gitignore")), readOrNull(path.join(dir, ".git", "info", "exclude"))].filter(Boolean);
        return own.length ? own.join("\n") : null;
      };
      return { name: names[i], abs: root, guard: createGuard(root, rules.filter(Boolean).join("\n"), fs.realpathSync, nestedRules) };
    });
    return new RepoTools(workspaceGuard(roots));
  }

  /** The file's text, from the editor when it is open there. */
  async readText(abs: string): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (open) return open.getText();
    return fs.promises.readFile(abs, "utf8");
  }

  /** The folder a command runs in: the project root, or a folder in it. */
  cwd(dir?: string): string {
    if (!dir && this.guard.single) return this.guard.roots[0].abs;
    if (!dir) throw new Error(`Say which folder to run it in (open folders: ${this.guard.roots.map((r) => r.name).join(", ")}).`);
    const resolved = this.guard.resolve(dir);
    if (!resolved.ok) throw new Error(`Can't run in ${dir}: ${resolved.reason}.`);
    if (!fs.statSync(resolved.abs).isDirectory()) throw new Error(`${resolved.rel} is not a folder.`);
    return resolved.abs;
  }

  /**
   * The open folders and the repos in them, one per line, for the AI:
   * "shop/ (git; TypeScript, Node/JavaScript)". Looks two levels deep.
   */
  describe(): string {
    const lines: string[] = [];
    const describeDir = (abs: string, label: string) => {
      const kinds = MARKERS.filter(([file]) => exists(path.join(abs, file))).map(([, kind]) => kind);
      const git = exists(path.join(abs, ".git"));
      if (!git && !kinds.length) return false;
      lines.push(`${label} (${[git ? "git" : "", [...new Set(kinds)].join(", ")].filter(Boolean).join("; ")})`);
      return true;
    };
    const subdirs = (abs: string) => {
      try {
        return fs
          .readdirSync(abs, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIPPED_DIRS.includes(d.name))
          .map((d) => d.name)
          .sort();
      } catch {
        return [];
      }
    };
    for (const root of this.guard.roots) {
      const prefix = this.guard.single ? "" : `${root.name}/`;
      describeDir(root.abs, prefix || "./");
      for (const a of subdirs(root.abs)) {
        if (lines.length >= MAX_REPOS_DESCRIBED) break;
        const aAbs = path.join(root.abs, a);
        if (!this.guard.resolve(`${prefix}${a}`).ok) continue;
        if (describeDir(aAbs, `${prefix}${a}/`) && !exists(path.join(aAbs, ".git"))) continue;
        // One level further, for a folder of repos (e.g. apps/web, apps/api).
        if (!exists(path.join(aAbs, ".git"))) {
          for (const b of subdirs(aAbs)) {
            if (lines.length >= MAX_REPOS_DESCRIBED) break;
            if (this.guard.resolve(`${prefix}${a}/${b}`).ok) describeDir(path.join(aAbs, b), `${prefix}${a}/${b}/`);
          }
        }
      }
    }
    if (!this.guard.single && !lines.length) lines.push(...this.guard.roots.map((r) => `${r.name}/`));
    return lines.slice(0, MAX_REPOS_DESCRIBED).join("\n");
  }

  /** Files to search: every open folder, or the one a "folder/…" glob names. */
  private async searchFiles(glob?: string): Promise<{ files: { abs: string; rel: string }[]; capped: boolean }> {
    const exclude = `**/{${SKIPPED_DIRS.join(",")}}/**`;
    let targets = this.guard.roots.map((root) => ({ root, pattern: glob || "**/*" }));
    if (!this.guard.single && glob) {
      const [first, ...rest] = glob.split("/");
      const named = this.guard.roots.find((r) => r.name === first);
      if (named) targets = [{ root: named, pattern: rest.join("/") || "**/*" }];
    }
    const files: { abs: string; rel: string }[] = [];
    let capped = false;
    for (const { root, pattern } of targets) {
      const left = MAX_SEARCH_FILES - files.length;
      if (left <= 0) {
        capped = true;
        break;
      }
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(root.abs), pattern), exclude, left);
      if (found.length >= left) capped = true;
      for (const uri of found) {
        if (BINARY.test(uri.fsPath)) continue;
        const rel = this.guard.relOf(uri.fsPath);
        if (rel && this.guard.resolve(rel).ok) files.push({ abs: uri.fsPath, rel });
      }
    }
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return { files, capped };
  }

  async search(query: string, glob?: string): Promise<string> {
    const { files, capped } = await this.searchFiles(glob);
    const matches: string[][] = new Array(files.length);
    let found = 0;
    // Read in parallel batches, keeping the results in path order.
    for (let start = 0; start < files.length && found < MAX_MATCHES; start += READ_IN_PARALLEL) {
      const batch = files.slice(start, start + READ_IN_PARALLEL);
      await Promise.all(
        batch.map(async (file, i) => {
          try {
            const stat = await fs.promises.stat(file.abs);
            if (stat.size > MAX_FILE_BYTES) return;
            const text = await this.readText(file.abs);
            if (text.includes("\0")) return; // binary
            const lines = matchLines(text, query, MAX_MATCHES).map((m) => `${file.rel}:${m.line}: ${m.text}`);
            matches[start + i] = lines;
            found += lines.length;
          } catch {
            // unreadable file: skip
          }
        })
      );
    }
    const lines = matches.filter(Boolean).flat().slice(0, MAX_MATCHES);
    if (!lines.length) return capped ? `No matches in the first ${MAX_SEARCH_FILES} files; narrow the search with glob.` : "No matches.";
    const notes = [];
    if (lines.length >= MAX_MATCHES) notes.push(`first ${MAX_MATCHES} matches; search for something more specific`);
    if (capped) notes.push(`searched the first ${MAX_SEARCH_FILES} files; narrow with glob`);
    return lines.join("\n") + (notes.length ? `\n(${notes.join("; ")})` : "");
  }

  async list(dir = ""): Promise<string> {
    if (!this.guard.single && (!dir || dir === "." || dir === "./")) {
      return this.guard.roots.map((r) => `${r.name}/`).join("\n");
    }
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

  /** Errors and warnings the editor shows for files in the project (or under `scope`). */
  problems(scope?: string): string {
    let prefix = "";
    if (scope) {
      const resolved = this.guard.resolve(scope);
      if (!resolved.ok) throw new Error(`Can't check ${scope}: ${resolved.reason}.`);
      prefix = resolved.rel;
    }
    const lines: string[] = [];
    let total = 0;
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== "file") continue;
      const rel = this.guard.relOf(uri.fsPath);
      if (!rel) continue;
      if (prefix && rel !== prefix && !rel.startsWith(prefix + "/")) continue;
      if (!this.guard.resolve(rel).ok) continue;
      for (const d of diagnostics) {
        if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
        total++;
        if (lines.length >= MAX_PROBLEMS) continue;
        const kind = d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
        const source = d.source ? ` (${d.source})` : "";
        lines.push(`${rel}:${d.range.start.line + 1}: ${kind}: ${d.message.split("\n")[0]}${source}`);
      }
    }
    if (!lines.length) {
      return "No errors or warnings shown in the editor. (The editor only checks files it has analysed; run the build or type check for a full check.)";
    }
    return lines.join("\n") + (total > lines.length ? `\n(${total - lines.length} more)` : "");
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
