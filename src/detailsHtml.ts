// The event details page shown in a webview. Everything from Hodor is
// escaped: names, descriptions and sample values are typed by people.

import { EventDetails, Property, STATUSES } from "./api";
import { statusLabel } from "./eventGroups";

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sample = (value: unknown) => (value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));

const propertyTable = (title: string, props: Property[]) =>
  props.length
    ? `<h2>${title}</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Sample</th><th>Description</th></tr></thead>
  <tbody>${props
    .map(
      (p) =>
        `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${escapeHtml(p.data_type)}</td><td><code>${escapeHtml(
          sample(p.sample_value)
        )}</code></td><td>${escapeHtml(p.description)}</td></tr>`
    )
    .join("")}</tbody>
</table>`
    : "";

export interface DetailsContext {
  languages: { id: string; label: string }[];
  selectedLanguage: string;
  nonce: string;
  cspSource: string;
}

export const renderDetails = (event: EventDetails, ctx: DetailsContext): string => {
  const option = (value: string, label: string, selected: boolean) =>
    `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const list = (values: string[]) => escapeHtml(values.join(", ") || "—");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${ctx.cspSource} 'unsafe-inline'; script-src 'nonce-${ctx.nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 0 20px 24px; line-height: 1.5; }
  h1 { font-size: 1.4em; margin: 18px 0 4px; word-break: break-all; }
  h2 { font-size: 1.05em; margin: 22px 0 6px; }
  .description { color: var(--vscode-descriptionForeground); margin: 0 0 14px; white-space: pre-wrap; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
  dt { color: var(--vscode-descriptionForeground); }
  dd { margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 16px 0 4px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 12px; border-radius: 2px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 3px 4px; font: inherit; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { color: var(--vscode-descriptionForeground); font-weight: normal; }
  code { font-family: var(--vscode-editor-font-family); word-break: break-all; }
</style>
</head>
<body>
<h1>${escapeHtml(event.name)}</h1>
<p class="description">${escapeHtml(event.description) || "No description."}</p>
<dl>
  <dt><label for="status">Status</label></dt>
  <dd><select id="status">${STATUSES.map((s) => option(s, statusLabel(s), s === event.status)).join("")}</select></dd>
  <dt>Platforms</dt><dd>${list(event.platform)}</dd>
  <dt>Source</dt><dd>${list(event.source)}</dd>
</dl>
<div class="actions">
  <select id="language" aria-label="Language">${ctx.languages
    .map((l) => option(l.id, l.label, l.id === ctx.selectedLanguage))
    .join("")}</select>
  <button id="copy">Copy code</button>
  <button id="copyFile" class="secondary">Copy full file</button>
  <button id="open" class="secondary">Open in Hodor</button>
</div>
${propertyTable("Event properties", event.event_properties)}
${propertyTable("Super properties", event.super_properties)}
${propertyTable("User properties", event.user_properties)}
<script nonce="${ctx.nonce}">
  const vscode = acquireVsCodeApi();
  const language = () => document.getElementById("language").value;
  document.getElementById("copy").addEventListener("click", () => vscode.postMessage({ type: "copy", language: language() }));
  document.getElementById("copyFile").addEventListener("click", () => vscode.postMessage({ type: "copyFile", language: language() }));
  document.getElementById("open").addEventListener("click", () => vscode.postMessage({ type: "open" }));
  document.getElementById("language").addEventListener("change", () => vscode.postMessage({ type: "language", language: language() }));
  document.getElementById("status").addEventListener("change", (e) => vscode.postMessage({ type: "status", status: e.target.value }));
</script>
</body>
</html>`;
};
