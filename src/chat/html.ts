// The chat's webview page. The page draws the state the extension posts to it,
// always through textContent, so nothing from the AI, Hodor or the code is
// ever parsed as HTML. Scripts run only with the nonce.
//
// Never name a top-level script variable like a browser global (top, parent,
// name, status…): that stops the whole page (a unit test checks).

export const renderChatPage = ({ nonce, cspSource }: { nonce: string; cspSource: string }): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; background: var(--vscode-sideBar-background); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; border-radius: 4px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.ghost { background: transparent; color: var(--vscode-foreground); opacity: 0.8; }
  button.ghost:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
  button:disabled { opacity: 0.45; cursor: default; }
  code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }

  #header { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  #header .title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #history { display: none; flex: 1; overflow-y: auto; padding: 6px 8px; }
  #history .chat { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  #history .chat:hover, #history .chat.current { background: var(--vscode-list-hoverBackground); }
  #history .chat .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #history .chat .when { color: var(--vscode-descriptionForeground); font-size: 0.85em; white-space: nowrap; }
  #history .empty { color: var(--vscode-descriptionForeground); padding: 8px; }

  #log { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 4px 0; line-height: 1.6; }
  .empty b { color: var(--vscode-foreground); display: block; margin-bottom: 4px; }
  .suggest { display: block; text-align: left; margin: 4px 0; width: 100%; background: var(--vscode-input-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 6px 8px; }
  .suggest:hover { background: var(--vscode-list-hoverBackground); }

  .msg { margin: 10px 0; line-height: 1.5; word-wrap: break-word; }
  .user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; }
  .assistant > :first-child { margin-top: 0; }
  .assistant p { margin: 6px 0; white-space: pre-wrap; }
  .assistant h1, .assistant h2, .assistant h3, .assistant h4, .assistant h5, .assistant h6 { font-size: 1.05em; margin: 12px 0 4px; }
  .assistant ul, .assistant ol { margin: 4px 0; padding-left: 20px; }
  .assistant li { margin: 2px 0; }
  .assistant blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border)); color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
  .assistant a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  .assistant a:hover { text-decoration: underline; }
  .assistant table { border-collapse: collapse; margin: 6px 0; display: block; overflow-x: auto; }
  .assistant th, .assistant td { border: 1px solid var(--vscode-panel-border); padding: 3px 8px; text-align: left; }
  .assistant th { background: var(--vscode-textCodeBlock-background); }
  .codeblock { margin: 8px 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
  .codeblock .bar { display: flex; align-items: center; padding: 2px 4px 2px 10px; background: var(--vscode-textCodeBlock-background); font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .codeblock .bar span { flex: 1; }
  .codeblock pre, .cmd pre { margin: 0; padding: 8px 10px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; }
  .answer-actions { margin: -6px 0 8px; }
  .answer-actions button { font-size: 0.85em; padding: 1px 6px; }

  .step { display: flex; gap: 6px; align-items: flex-start; margin: 3px 0; color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  .step .mark { width: 14px; flex: none; text-align: center; }
  .step.ok .mark { color: var(--vscode-testing-iconPassed, #3fb950); }
  .step.error .mark { color: var(--vscode-errorForeground); }
  .step .label { flex: 1; word-break: break-word; }
  .step .label.link { cursor: pointer; }
  .step .label.link:hover { text-decoration: underline; }
  .step .detail { display: block; color: var(--vscode-errorForeground); }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  details.group { margin: 3px 0; color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  details.group > summary { cursor: pointer; list-style: none; display: flex; gap: 6px; }
  details.group > summary::-webkit-details-marker { display: none; }
  details.group > summary .chev { width: 14px; text-align: center; }
  details.group[open] > summary .chev { transform: rotate(90deg); }
  details.group .inner { margin-left: 8px; padding-left: 8px; border-left: 1px solid var(--vscode-panel-border); }
  .edit-actions { display: flex; gap: 6px; margin: 2px 0 6px 20px; flex-wrap: wrap; align-items: center; }
  .tag { font-size: 0.85em; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .cmd { margin: 2px 0 8px 20px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
  .cmd .line { background: var(--vscode-textCodeBlock-background); color: var(--vscode-foreground); }
  .cmd .output { max-height: 240px; overflow-y: auto; white-space: pre-wrap; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
  .cmd .edit-actions { margin: 6px 8px; }
  .notice { margin: 8px 0; padding: 6px 10px; border-left: 3px solid var(--vscode-editorInfo-foreground); background: var(--vscode-textBlockQuote-background); border-radius: 0 4px 4px 0; }
  .notice.error { border-left-color: var(--vscode-errorForeground); }
  .notice button { margin-left: 8px; }

  .bar { display: none; padding: 6px 12px; gap: 6px; flex-wrap: wrap; align-items: center; }
  #planBar { background: var(--vscode-textBlockQuote-background); border-top: 1px solid var(--vscode-panel-border); }
  #planBar span { flex: 1; }

  #composer { margin: 6px 10px 4px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 10px; background: var(--vscode-input-background); }
  #composer:focus-within { border-color: var(--vscode-focusBorder); }
  #composer.drag { border-style: dashed; border-color: var(--vscode-focusBorder); }
  #attachments { display: none; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
  .thumbs img, #attachments img { max-width: 120px; max-height: 80px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); }
  .msg.user .thumbs { margin-bottom: 6px; }
  .thumb { position: relative; }
  .thumb button { position: absolute; top: -6px; right: -6px; padding: 0 5px; border-radius: 8px; font-size: 0.8em; }
  textarea { display: block; width: 100%; box-sizing: border-box; resize: none; min-height: 40px; max-height: 200px; background: transparent; color: var(--vscode-input-foreground); border: none; padding: 9px 12px 4px; font: inherit; outline: none; }
  #tools { display: flex; align-items: center; gap: 4px; padding: 4px 6px 6px; }
  #tools .spacer { flex: 1; }
  .chip { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid transparent; border-radius: 6px; font: inherit; font-size: 0.9em; padding: 2px 4px; max-width: 46%; cursor: pointer; }
  .chip:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  .chip option { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
  #mode.plan { color: var(--vscode-charts-blue, #3794ff); }
  #mode.auto { color: var(--vscode-charts-yellow, #cca700); }
  #mode.full { color: var(--vscode-errorForeground); }
  #send, #stop { width: 28px; height: 28px; border-radius: 50%; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; line-height: 1; }
  #stop { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 11px; }
  #attach { width: 26px; height: 26px; border-radius: 6px; padding: 0; font-size: 17px; line-height: 1; }
  .hint { padding: 0 12px 6px; color: var(--vscode-descriptionForeground); font-size: 0.8em; }
</style>
</head>
<body>
<div id="header">
  <span class="title" id="chatTitle">New chat</span>
  <button id="historyBtn" class="ghost" title="Past chats" aria-label="Past chats">History</button>
  <button id="newBtn" class="ghost" title="New chat" aria-label="New chat">＋ New</button>
</div>
<div id="history"></div>
<div id="log"></div>
<div id="planBar" class="bar"><span>Plan ready. Approve it to start, or reply to change it.</span><button id="approve">Approve plan</button></div>
<div id="applyBar" class="bar"><button id="applyAll">Apply all changes</button></div>
<form id="composer">
  <div id="attachments"></div>
  <textarea id="input" rows="1" placeholder="Ask Hodor… (paste screenshots here)" aria-label="Message"></textarea>
  <div id="tools">
    <button id="attach" type="button" class="ghost" title="Attach a screenshot (or paste one)" aria-label="Attach a screenshot">+</button>
    <input id="file" type="file" accept="image/*" multiple style="display:none">
    <select id="mode" class="chip" title="What the AI may do without asking" aria-label="Mode"></select>
    <select id="model" class="chip" title="AI model (you can switch any time; the chat continues)" aria-label="Model"></select>
    <span class="spacer"></span>
    <button id="send" type="submit" title="Send (Enter)" aria-label="Send">↑</button>
    <button id="stop" type="button" title="Stop" aria-label="Stop" style="display:none">■</button>
  </div>
</form>
<div class="hint">Enter to send · Shift+Enter for a new line · Mac dictation: press Fn twice</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const historyPane = document.getElementById("history");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const stop = document.getElementById("stop");
  const composer = document.getElementById("composer");
  const planBar = document.getElementById("planBar");
  const applyBar = document.getElementById("applyBar");
  const modeSelect = document.getElementById("mode");
  const modelSelect = document.getElementById("model");
  const chatTitle = document.getElementById("chatTitle");
  const attachments = document.getElementById("attachments");
  const fileInput = document.getElementById("file");
  const MARK = { running: "↻", ok: "✓", error: "✗" };
  const ACTION_LABEL = { retry: "Retry", continue: "Continue", settings: "Add your AI key in Hodor", useClaude: "Continue with Claude Haiku" };
  const QUIET = ["search", "folder", "read", "events", "code", "problems"];
  const MAX_IMAGES = 4;
  const MAX_SIDE = 1568;
  let pending = [];
  let showHistory = false;
  let lastView = null;
  const openGroups = new Set();
  let stickToBottom = true;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, message, cls) => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage(message);
    });
    return b;
  };
  const copyButton = (label, text, cls) => button(label, { type: "copy", text }, cls);

  function ago(ms) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  // ---- screenshots: shrunk here (1568 px, JPEG); every request carries the whole chat.
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

  // ---- answers (parsed Markdown blocks from the extension)
  function inline(parent, parts) {
    for (const part of parts || []) {
      if (part.kind === "code") parent.appendChild(el("code", "", part.text));
      else if (part.kind === "bold") parent.appendChild(el("b", "", part.text));
      else if (part.kind === "italic") parent.appendChild(el("i", "", part.text));
      else if (part.kind === "link") {
        const a = el("a", "", part.text);
        a.title = part.href;
        a.addEventListener("click", () => vscode.postMessage({ type: "link", href: part.href }));
        parent.appendChild(a);
      } else parent.appendChild(document.createTextNode(part.text));
    }
    return parent;
  }
  function renderAnswer(blocks) {
    const box = el("div", "msg assistant");
    for (const b of blocks) {
      if (b.kind === "heading") box.appendChild(inline(el("h" + Math.min(6, Math.max(1, b.level))), b.inline));
      else if (b.kind === "paragraph") box.appendChild(inline(el("p"), b.inline));
      else if (b.kind === "quote") box.appendChild(inline(el("blockquote"), b.inline));
      else if (b.kind === "list") {
        const list = el(b.ordered ? "ol" : "ul");
        for (const item of b.items) {
          const li = inline(el("li"), item.inline);
          if (item.depth) {
            li.style.marginLeft = item.depth * 16 + "px";
            li.style.listStyleType = "circle";
          }
          list.appendChild(li);
        }
        box.appendChild(list);
      } else if (b.kind === "table") {
        const table = el("table");
        const head = el("tr");
        for (const cell of b.header) head.appendChild(inline(el("th"), cell));
        table.appendChild(head);
        for (const row of b.rows) {
          const tr = el("tr");
          for (const cell of row) tr.appendChild(inline(el("td"), cell));
          table.appendChild(tr);
        }
        box.appendChild(table);
      } else if (b.kind === "code") {
        const wrap = el("div", "codeblock");
        const bar = el("div", "bar");
        bar.appendChild(el("span", "", b.lang || "code"));
        bar.appendChild(copyButton("Copy", b.text, "ghost"));
        wrap.appendChild(bar);
        wrap.appendChild(el("pre", "", b.text));
        box.appendChild(wrap);
      }
    }
    return box;
  }

  // ---- steps
  function renderStep(item) {
    const frag = document.createDocumentFragment();
    const row = el("div", "step " + item.status);
    const mark = el("span", "mark" + (item.status === "running" ? " spin" : ""), MARK[item.status]);
    const label = el("span", "label" + (item.path ? " link" : ""), item.label);
    if (item.path) label.addEventListener("click", () => vscode.postMessage({ type: "open", path: item.path, line: item.line }));
    if (item.detail) label.appendChild(el("span", "detail", item.detail));
    row.append(mark, label);
    frag.appendChild(row);
    if (item.command) frag.appendChild(renderCommand(item));
    if (item.editId) {
      const actions = el("div", "edit-actions");
      if (item.editStatus !== "expired") actions.appendChild(button("View change", { type: "diff", id: item.editId }, "secondary"));
      if (item.editStatus === "proposed") {
        actions.appendChild(button("Apply", { type: "apply", id: item.editId }));
        actions.appendChild(button("Skip", { type: "skip", id: item.editId }, "secondary"));
      } else {
        actions.appendChild(el("span", "tag", item.editStatus === "expired" ? "from an earlier session" : item.editStatus));
      }
      frag.appendChild(actions);
    }
    return frag;
  }
  function renderCommand(item) {
    const box = el("div", "cmd");
    box.appendChild(el("pre", "line", "$ " + item.command));
    if (item.commandState === "waiting") {
      const actions = el("div", "edit-actions");
      actions.appendChild(button("Run", { type: "runCommand", id: item.id }));
      actions.appendChild(button("Skip", { type: "skipCommand", id: item.id }, "secondary"));
      actions.appendChild(copyButton("Copy", item.command, "ghost"));
      box.appendChild(actions);
    } else if (item.commandState === "skipped") {
      const actions = el("div", "edit-actions");
      actions.appendChild(el("span", "tag", "skipped"));
      box.appendChild(actions);
    }
    if (item.output) {
      const out = el("pre", "output", item.output);
      box.appendChild(out);
      requestAnimationFrame(() => (out.scrollTop = out.scrollHeight));
    }
    return box;
  }
  const quiet = (item) => item.kind === "step" && QUIET.includes(item.icon) && !item.editId && !item.command && item.status !== "error";
  function groupSummary(steps) {
    const running = steps.find((s) => s.status === "running");
    if (running) return running.label;
    const counts = {};
    for (const s of steps) counts[s.icon] = (counts[s.icon] || 0) + 1;
    const words = { read: ["file read", "files read"], search: ["search", "searches"], folder: ["folder listed", "folders listed"], events: ["Hodor lookup", "Hodor lookups"], code: ["code lookup", "code lookups"], problems: ["problems check", "problems checks"] };
    return Object.entries(counts).map(([k, n]) => n + " " + (words[k] ? words[k][n === 1 ? 0 : 1] : k)).join(", ");
  }

  // ---- the whole view
  const emptyText = {
    signedOut: ["Sign in to Hodor to use the chat.", { type: "signIn" }, "Sign in"],
    noProject: ["Pick the Hodor product for this project.", { type: "pickProject" }, "Pick a product"],
    noFolder: ["Open your project folder: the chat works on the code that is open.", null, null],
  };
  const SUGGESTIONS = ["How many events are not implemented?", "Implement the events that are not started", "Run the build and fix any errors", "Check that our tracking code matches the plan"];

  function renderHistory(view) {
    historyPane.textContent = "";
    const chats = (view.history && view.history.chats) || [];
    if (!chats.length) historyPane.appendChild(el("div", "empty", "No saved chats yet."));
    for (const c of chats) {
      const row = el("div", "chat" + (view.history.current === c.id ? " current" : ""));
      row.title = c.title;
      row.appendChild(el("span", "t", c.title));
      row.appendChild(el("span", "when", ago(c.updatedAt)));
      const del = button("✕", { type: "deleteChat", id: c.id }, "ghost");
      del.title = "Delete this chat";
      row.appendChild(del);
      row.addEventListener("click", () => {
        showHistory = false;
        vscode.postMessage({ type: "openChat", id: c.id });
        draw();
      });
      historyPane.appendChild(row);
    }
  }

  function renderControls(view) {
    const ai = view.ai || {};
    modeSelect.textContent = "";
    for (const m of ai.modes || []) {
      const o = el("option", "", m.label);
      o.value = m.id;
      o.title = m.hint;
      modeSelect.appendChild(o);
    }
    modeSelect.value = ai.mode || "ask";
    modeSelect.className = "chip " + (ai.mode || "ask");
    modelSelect.textContent = "";
    const models = ai.models || [];
    let group = null;
    for (const m of models) {
      if (!group || group.dataset.provider !== m.provider) {
        group = el("optgroup");
        group.label = m.provider === "gemini" ? "Google Gemini" : "Claude";
        group.dataset.provider = m.provider;
        modelSelect.appendChild(group);
      }
      const o = el("option", "", m.short || m.label);
      o.value = m.id;
      o.title = m.label;
      group.appendChild(o);
    }
    if (ai.model) modelSelect.value = ai.model;
    modelSelect.style.display = models.length ? "" : "none";
  }

  function draw() {
    const view = lastView;
    if (!view) return;
    const { mode, state } = view;
    const ready = mode === "ready";
    renderControls(view);
    chatTitle.textContent = showHistory ? "Past chats" : view.title || "New chat";
    document.getElementById("historyBtn").textContent = showHistory ? "Back" : "History";
    historyPane.style.display = showHistory ? "block" : "none";
    log.style.display = showHistory ? "none" : "block";
    if (showHistory) renderHistory(view);

    input.disabled = !ready;
    log.textContent = "";
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
      box.appendChild(el("b", "", "What should Hodor do?"));
      for (const s of SUGGESTIONS) {
        const b = el("button", "suggest", s);
        b.type = "button";
        b.addEventListener("click", () => {
          input.value = s;
          input.focus();
          grow();
        });
        box.appendChild(b);
      }
      log.appendChild(box);
    }

    const items = state.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (quiet(item)) {
        // A run of quiet steps (reads, searches…) folds into one line.
        const run = [item];
        while (i + 1 < items.length && quiet(items[i + 1])) run.push(items[++i]);
        if (run.length < 3) {
          for (const s of run) log.appendChild(renderStep(s));
          continue;
        }
        const key = run[0].id;
        const details = el("details", "group");
        details.open = openGroups.has(key);
        details.addEventListener("toggle", () => (details.open ? openGroups.add(key) : openGroups.delete(key)));
        const summary = el("summary");
        const busy = run.some((s) => s.status === "running");
        summary.appendChild(el("span", "chev" + (busy ? " spin" : ""), busy ? "↻" : "›"));
        summary.appendChild(el("span", "", groupSummary(run)));
        details.appendChild(summary);
        const inner = el("div", "inner");
        for (const s of run) inner.appendChild(renderStep(s));
        details.appendChild(inner);
        log.appendChild(details);
        continue;
      }
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
      } else if (item.kind === "assistant") {
        log.appendChild(renderAnswer(item.blocks || []));
        if (!state.running || i < items.length - 1) {
          const actions = el("div", "answer-actions");
          actions.appendChild(copyButton("Copy", item.text, "ghost"));
          log.appendChild(actions);
        }
      } else if (item.kind === "notice") {
        const box = el("div", "notice " + item.tone, item.text);
        if (item.action) box.appendChild(button(ACTION_LABEL[item.action], { type: item.action }, "secondary"));
        log.appendChild(box);
      } else if (item.kind === "step") {
        log.appendChild(renderStep(item));
      }
    }
    const proposed = items.filter((it) => it.kind === "step" && it.editStatus === "proposed").length;
    applyBar.style.display = proposed > 1 && !state.running ? "flex" : "none";
    planBar.style.display = state.planReady && !state.running ? "flex" : "none";
    send.style.display = state.running ? "none" : "";
    stop.style.display = state.running ? "" : "none";
    modelSelect.disabled = state.running;
    if (stickToBottom) log.scrollTop = log.scrollHeight;
  }

  log.addEventListener("scroll", () => {
    stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  });

  function grow() {
    input.style.height = "auto";
    input.style.height = Math.min(200, input.scrollHeight) + "px";
  }

  window.addEventListener("message", (e) => {
    lastView = e.data;
    draw();
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim() && !pending.length) return;
    vscode.postMessage({ type: "send", text: input.value, images: pending });
    input.value = "";
    pending = [];
    drawAttachments();
    grow();
    stickToBottom = true;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  input.addEventListener("input", grow);
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
  stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  document.getElementById("applyAll").addEventListener("click", () => vscode.postMessage({ type: "applyAll" }));
  document.getElementById("approve").addEventListener("click", () => vscode.postMessage({ type: "approvePlan" }));
  document.getElementById("attach").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });
  modeSelect.addEventListener("change", () => vscode.postMessage({ type: "setMode", mode: modeSelect.value }));
  modelSelect.addEventListener("change", () => vscode.postMessage({ type: "setModel", model: modelSelect.value }));
  document.getElementById("historyBtn").addEventListener("click", () => {
    showHistory = !showHistory;
    if (showHistory) vscode.postMessage({ type: "listChats" });
    draw();
  });
  document.getElementById("newBtn").addEventListener("click", () => {
    showHistory = false;
    vscode.postMessage({ type: "newChat" });
    draw();
    input.focus();
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
