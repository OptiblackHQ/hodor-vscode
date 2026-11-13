// The chat's webview page. The page draws the state the extension posts to it,
// always through textContent, so nothing from Claude, Hodor or the code is
// ever parsed as HTML. Scripts run only with the nonce.

export const renderChatPage = ({ nonce, cspSource }: { nonce: string; cspSource: string }): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
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
  .assistant > :first-child { margin-top: 0; }
  .assistant p { margin: 6px 0; white-space: pre-wrap; }
  .assistant h1, .assistant h2, .assistant h3, .assistant h4, .assistant h5, .assistant h6 { font-size: 1.05em; margin: 10px 0 4px; }
  .assistant ul, .assistant ol { margin: 4px 0; padding-left: 20px; }
  code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
  .codeblock { position: relative; margin: 6px 0; }
  .codeblock pre, .cmd pre { margin: 0; padding: 8px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; }
  .codeblock .copy { position: absolute; top: 4px; right: 4px; font-size: 0.85em; padding: 1px 6px; opacity: 0.85; }
  .msg.assistant { white-space: normal; }
  .answer-actions { margin: -4px 0 8px; }
  .answer-actions button { font-size: 0.85em; padding: 1px 6px; }
  .cmd { margin: 2px 0 6px 20px; }
  .cmd .line { color: var(--vscode-foreground); }
  .cmd .output { max-height: 220px; overflow-y: auto; margin-top: 4px; white-space: pre-wrap; }
  #top { display: none; align-items: center; gap: 6px; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, transparent); font: inherit; padding: 1px 4px; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
  .thumbs img { max-width: 120px; max-height: 80px; border-radius: 3px; border: 1px solid var(--vscode-panel-border); }
  #attachments { display: none; padding: 6px 10px 0; }
  .thumb { position: relative; }
  .thumb button { position: absolute; top: -6px; right: -6px; padding: 0 5px; border-radius: 8px; font-size: 0.8em; }
  .msg.user .thumbs { margin-bottom: 4px; }
  #composer.drag { outline: 1px dashed var(--vscode-focusBorder); }
  #attach { padding: 3px 8px; }
</style>
</head>
<body>
<div id="top"><label for="provider">AI</label><select id="provider"><option value="claude">Claude</option><option value="gemini">Gemini</option></select><span>switching starts a new chat</span></div>
<div id="log"></div>
<div id="bar"><button id="applyAll">Apply all changes</button></div>
<div id="attachments" class="thumbs"></div>
<form id="composer">
  <button id="attach" type="button" class="secondary" title="Attach a screenshot (or paste one)" aria-label="Attach a screenshot">+ Image</button>
  <input id="file" type="file" accept="image/*" multiple style="display:none">
  <textarea id="input" rows="1" placeholder="Ask anything about the code, or “implement the missing events”" aria-label="Message"></textarea>
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
  const ACTION_LABEL = { retry: "Retry", continue: "Continue", settings: "Add your AI key in Hodor" };
  const topBar = document.getElementById("top");
  const providerSelect = document.getElementById("provider");
  const attachments = document.getElementById("attachments");
  const fileInput = document.getElementById("file");
  const composer = document.getElementById("composer");
  const MAX_IMAGES = 4;
  const MAX_SIDE = 1568;
  let pending = [];

  // Screenshots are shrunk here (longest side 1568 px, JPEG): every request
  // carries the whole chat, so full-size images would soon be too big.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("unreadable"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("not an image"));
        img.onload = () => {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith("image/") || pending.length >= MAX_IMAGES) continue;
      try {
        pending.push(await shrink(file));
      } catch {
        // not an image we can read
      }
    }
    drawAttachments();
  }

  function drawAttachments() {
    attachments.textContent = "";
    attachments.style.display = pending.length ? "flex" : "none";
    pending.forEach((url, i) => {
      const box = el("div", "thumb");
      const img = el("img");
      img.src = url;
      img.alt = "Screenshot " + (i + 1);
      const remove = el("button", "secondary", "✕");
      remove.type = "button";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        pending.splice(i, 1);
        drawAttachments();
      });
      box.append(img, remove);
      attachments.appendChild(box);
    });
  }

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

  const copyButton = (label, text, cls) => button(label, { type: "copy", text }, cls);

  function inline(parent, parts) {
    for (const part of parts) {
      if (part.kind === "code") parent.appendChild(el("code", "", part.text));
      else if (part.kind === "bold") parent.appendChild(el("b", "", part.text));
      else parent.appendChild(document.createTextNode(part.text));
    }
    return parent;
  }

  function renderAnswer(blocks) {
    const box = el("div", "msg assistant");
    for (const b of blocks) {
      if (b.kind === "heading") box.appendChild(inline(el("h" + Math.min(6, Math.max(1, b.level))), b.inline));
      else if (b.kind === "paragraph") box.appendChild(inline(el("p"), b.inline));
      else if (b.kind === "list") {
        const list = el(b.ordered ? "ol" : "ul");
        for (const parts of b.items) list.appendChild(inline(el("li"), parts));
        box.appendChild(list);
      } else if (b.kind === "code") {
        const wrap = el("div", "codeblock");
        wrap.appendChild(el("pre", "", b.text));
        wrap.appendChild(copyButton("Copy", b.text, "copy secondary"));
        box.appendChild(wrap);
      }
    }
    return box;
  }

  function renderCommand(item) {
    const box = el("div", "cmd");
    const line = el("pre", "line", "$ " + item.command);
    box.appendChild(line);
    if (item.commandState === "waiting") {
      const actions = el("div", "edit-actions");
      actions.style.marginLeft = "0";
      actions.appendChild(button("Run", { type: "runCommand", id: item.id }));
      actions.appendChild(button("Skip", { type: "skipCommand", id: item.id }, "secondary"));
      actions.appendChild(copyButton("Copy", item.command, "secondary"));
      box.appendChild(actions);
    } else if (item.commandState === "skipped") {
      box.appendChild(el("span", "tag", "skipped"));
    }
    if (item.output) {
      const out = el("pre", "output", item.output);
      box.appendChild(out);
      // Follow live output.
      requestAnimationFrame(() => (out.scrollTop = out.scrollHeight));
    }
    return box;
  }

  const emptyText = {
    signedOut: ["Sign in to Hodor to use the chat.", { type: "signIn" }, "Sign in"],
    noProject: ["Pick the Hodor product for this project.", { type: "pickProject" }, "Pick a product"],
    noFolder: ["Open your project folder: the chat works on the code that is open.", null, null],
  };

  function render(view) {
    const { mode, state, ai } = view;
    const both = ai && ai.available.claude && ai.available.gemini;
    topBar.style.display = mode === "ready" && both ? "flex" : "none";
    if (ai) providerSelect.value = ai.provider;
    providerSelect.disabled = state.running;
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
      box.appendChild(el("div", "", "• Paste events from a sheet and say “implement these”"));
      box.appendChild(el("div", "", "• Fix the errors in this project"));
      log.appendChild(box);
    }
    for (const item of state.items) {
      if (item.kind === "user") {
        const box = el("div", "msg user");
        if (item.images && item.images.length) {
          const thumbs = el("div", "thumbs");
          for (const url of item.images) {
            const img = el("img");
            img.src = url;
            img.alt = "Screenshot";
            thumbs.appendChild(img);
          }
          box.appendChild(thumbs);
        }
        box.appendChild(document.createTextNode(item.text));
        log.appendChild(box);
      }
      else if (item.kind === "assistant") {
        log.appendChild(renderAnswer(item.blocks || []));
        const actions = el("div", "answer-actions");
        actions.appendChild(copyButton("Copy answer", item.text, "secondary"));
        log.appendChild(actions);
      }
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
        if (item.command) log.appendChild(renderCommand(item));
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
    if (!input.value.trim() && !pending.length) return;
    vscode.postMessage({ type: "send", text: input.value, images: pending });
    input.value = "";
    pending = [];
    drawAttachments();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("composer").requestSubmit();
    }
  });
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  providerSelect.addEventListener("change", () => vscode.postMessage({ type: "setProvider", provider: providerSelect.value }));
  document.getElementById("attach").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  composer.addEventListener("dragover", (e) => {
    e.preventDefault();
    composer.classList.add("drag");
  });
  composer.addEventListener("dragleave", () => composer.classList.remove("drag"));
  composer.addEventListener("drop", (e) => {
    e.preventDefault();
    composer.classList.remove("drag");
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  document.getElementById("applyAll").addEventListener("click", () => vscode.postMessage({ type: "applyAll" }));
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
