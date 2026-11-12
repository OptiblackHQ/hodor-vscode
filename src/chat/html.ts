// The chat's webview page. The page draws the state the extension posts to it,
// always through textContent, so nothing from Claude, Hodor or the code is
// ever parsed as HTML. Scripts run only with the nonce.

export const renderChatPage = ({ nonce, cspSource }: { nonce: string; cspSource: string }): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; }
  #log { flex: 1; overflow-y: auto; padding: 8px 10px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 4px 0; line-height: 1.5; }
  .empty b { color: var(--vscode-foreground); }
  .msg { white-space: pre-wrap; word-wrap: break-word; margin: 8px 0; line-height: 1.45; }
  .user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 6px 8px; }
  .step { display: flex; gap: 6px; align-items: flex-start; margin: 2px 0; color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  .step .mark { width: 14px; flex: none; text-align: center; }
  .step.ok .mark { color: var(--vscode-testing-iconPassed, #3fb950); }
  .step.error .mark { color: var(--vscode-errorForeground); }
  .step .label { flex: 1; word-break: break-word; }
  .step .label.link { cursor: pointer; text-decoration: underline dotted; }
  .step .detail { display: block; color: var(--vscode-errorForeground); }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .edit-actions { display: flex; gap: 6px; margin: 2px 0 6px 20px; flex-wrap: wrap; }
  .tag { font-size: 0.85em; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .notice { margin: 8px 0; padding: 6px 8px; border-left: 3px solid var(--vscode-editorInfo-foreground); background: var(--vscode-textBlockQuote-background); }
  .notice.error { border-left-color: var(--vscode-errorForeground); }
  .notice button { margin-left: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; border-radius: 2px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #bar { display: none; padding: 6px 10px; gap: 6px; border-top: 1px solid var(--vscode-panel-border); }
  #composer { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--vscode-panel-border); }
  textarea { flex: 1; resize: none; min-height: 34px; max-height: 140px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 6px; font: inherit; border-radius: 2px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
</style>
</head>
<body>
<div id="log"></div>
<div id="bar"><button id="applyAll">Apply all changes</button></div>
<form id="composer">
  <textarea id="input" rows="1" placeholder="Ask about the tracking plan, or “implement the missing events”" aria-label="Message"></textarea>
  <button id="send" type="submit">Send</button>
  <button id="stop" type="button" class="secondary" style="display:none">Stop</button>
</form>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const stop = document.getElementById("stop");
  const bar = document.getElementById("bar");
  const MARK = { running: "↻", ok: "✓", error: "✗" };
  const ACTION_LABEL = { retry: "Retry", continue: "Continue", settings: "Open Hodor settings" };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, message, cls) => {
    const b = el("button", cls, text);
    b.addEventListener("click", () => vscode.postMessage(message));
    return b;
  };

  const emptyText = {
    signedOut: ["Sign in to Hodor to use the chat.", { type: "signIn" }, "Sign in"],
    noProject: ["Pick the Hodor product for this project.", { type: "pickProject" }, "Pick a product"],
    noFolder: ["Open your project folder: the chat works on the code that is open.", null, null],
  };

  function render(view) {
    const { mode, state } = view;
    log.textContent = "";
    const ready = mode === "ready";
    input.disabled = !ready;
    if (!ready) {
      const [text, msg, label] = emptyText[mode];
      const box = el("div", "empty", text);
      if (msg) {
        box.appendChild(el("br"));
        box.appendChild(button(label, msg));
      }
      log.appendChild(box);
    } else if (!state.items.length) {
      const box = el("div", "empty");
      box.appendChild(el("b", "", "Ask Hodor"));
      box.appendChild(el("div", "", "• How many events are not implemented?"));
      box.appendChild(el("div", "", "• What does checkout_completed send?"));
      box.appendChild(el("div", "", "• Implement the events that are not started"));
      log.appendChild(box);
    }
    for (const item of state.items) {
      if (item.kind === "user" || item.kind === "assistant") log.appendChild(el("div", "msg " + item.kind, item.text));
      else if (item.kind === "notice") {
        const box = el("div", "notice " + item.tone, item.text);
        if (item.action) box.appendChild(button(ACTION_LABEL[item.action], { type: item.action }, "secondary"));
        log.appendChild(box);
      } else if (item.kind === "step") {
        const row = el("div", "step " + item.status);
        const mark = el("span", "mark" + (item.status === "running" ? " spin" : ""), MARK[item.status]);
        const label = el("span", "label" + (item.path ? " link" : ""), item.label);
        if (item.path) label.addEventListener("click", () => vscode.postMessage({ type: "open", path: item.path, line: item.line }));
        if (item.detail) label.appendChild(el("span", "detail", item.detail));
        row.append(mark, label);
        log.appendChild(row);
        if (item.editId) {
          const actions = el("div", "edit-actions");
          actions.appendChild(button("View change", { type: "diff", id: item.editId }, "secondary"));
          if (item.editStatus === "proposed") {
            actions.appendChild(button("Apply", { type: "apply", id: item.editId }));
            actions.appendChild(button("Skip", { type: "skip", id: item.editId }, "secondary"));
          } else {
            actions.appendChild(el("span", "tag", item.editStatus));
          }
          log.appendChild(actions);
        }
      }
    }
    const proposed = state.items.filter((i) => i.kind === "step" && i.editStatus === "proposed").length;
    bar.style.display = proposed > 1 && !state.running ? "flex" : "none";
    send.style.display = state.running ? "none" : "";
    stop.style.display = state.running ? "" : "none";
    log.scrollTop = log.scrollHeight;
  }

  window.addEventListener("message", (e) => render(e.data));
  document.getElementById("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    vscode.postMessage({ type: "send", text: input.value });
    input.value = "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("composer").requestSubmit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  document.getElementById("applyAll").addEventListener("click", () => vscode.postMessage({ type: "applyAll" }));
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
