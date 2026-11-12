import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const URL = process.env.HODOR_URL;
const TOKEN = process.env.HODOR_TOKEN;
const PROJECT = process.env.HODOR_PROJECT;
const PROJECT2 = process.env.HODOR_PROJECT2;

const COMMANDS = [
  "hodor.signIn",
  "hodor.signOut",
  "hodor.pickProject",
  "hodor.refresh",
  "hodor.search",
  "hodor.clearSearch",
  "hodor.openEvent",
  "hodor.setStatus",
  "hodor.copyCode",
  "hodor.openInHodor",
];

/** Waits until `check` returns something truthy. */
const until = async <T>(check: () => T, what: string, ms = 15000): Promise<NonNullable<T>> => {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

suite("Hodor extension", () => {
  let api: any;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("optiblack.hodor");
    assert.ok(ext, "extension is installed");
    api = await ext.activate();
  });

  test("registers every command", async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of COMMANDS) assert.ok(all.includes(id), `${id} is registered`);
  });

  test("starts signed out with no product", () => {
    assert.strictEqual(api.session.isSignedIn(), false);
    assert.strictEqual(api.choice.project, undefined);
  });

  suite("against a local Hodor", function () {
    suiteSetup(async function () {
      if (!URL || !TOKEN || !PROJECT || !PROJECT2) {
        console.log("Skipping: set HODOR_URL, HODOR_TOKEN, HODOR_PROJECT and HODOR_PROJECT2 to run these.");
        this.skip();
      }
      await vscode.workspace.getConfiguration("hodor").update("serverUrl", URL, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("hodor._setTokenForTests", TOKEN);
    });

    test("picks the product and lists its events by status", async () => {
      await vscode.commands.executeCommand("hodor.pickProject", PROJECT);
      assert.strictEqual(api.choice.project.id, PROJECT);
      const groups = await until(() => {
        const g = api.tree.getChildren();
        return g.length ? g : null;
      }, "events in the tree");
      const total = groups.reduce((n: number, node: any) => n + node.group.events.length, 0);
      assert.strictEqual(total, api.choice.project.total_events);
    });

    test("search narrows the list", async () => {
      await api.tree.setQuery("no event is called this");
      assert.deepStrictEqual(api.tree.getChildren(), []);
      await vscode.commands.executeCommand("hodor.clearSearch");
      assert.ok(api.tree.getChildren().length > 0);
    });

    test("copies an event's tracking code", async () => {
      const first = api.tree.getChildren()[0].group.events[0];
      await vscode.env.clipboard.writeText("");
      await vscode.commands.executeCommand("hodor.copyCode", first.id, "javascript");
      const text = await vscode.env.clipboard.readText();
      assert.match(text, /function track/);
      assert.match(text, /\/\/ Call it like this where the event happens:/);
    });

    test("opens the event details panel", async () => {
      const first = api.tree.getChildren()[0].group.events[0];
      await vscode.commands.executeCommand("hodor.openEvent", first.id);
      const tab = await until(
        () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === first.name),
        "the details panel"
      );
      assert.ok(tab);
    });

    test("marks an event implemented and back", async () => {
      const first = api.tree.getChildren()[0].group.events[0];
      const original = first.status;
      await vscode.commands.executeCommand("hodor.setStatus", first.id, "implemented");
      await until(() => api.tree.getEvent(first.id)?.status === "implemented", "status implemented");
      await vscode.commands.executeCommand("hodor.setStatus", first.id, original);
      await until(() => api.tree.getEvent(first.id)?.status === original, "status restored");
    });

    test("a change made in Hodor meanwhile is not overwritten", async () => {
      const event = api.tree.getChildren()[0].group.events[0];
      // Someone changes the event on the website; the tree still has the old version.
      const changed = await api.session.client.setStatus(PROJECT, event.id, "ready to implement", event.version);
      await vscode.commands.executeCommand("hodor.setStatus", event.id, "in progress");
      const reloaded = await until(() => {
        const e = api.tree.getEvent(event.id);
        return e && e.version === changed.version ? e : null;
      }, "the list to reload");
      assert.strictEqual(reloaded.status, "ready to implement", "the website's change is kept");
      await api.session.client.setStatus(PROJECT, event.id, event.status, reloaded.version);
    });

    test("a slow load of the previous product never replaces the new one", async () => {
      const client = api.session.client;
      const original = client.project.bind(client);
      client.project = async (id: string) => {
        if (id === PROJECT) await new Promise((r) => setTimeout(r, 1500));
        return original(id);
      };
      try {
        void vscode.commands.executeCommand("hodor.refresh"); // slow load of PROJECT
        await new Promise((r) => setTimeout(r, 100));
        await vscode.commands.executeCommand("hodor.pickProject", PROJECT2);
        await until(() => api.tree.getEvent && api.tree.getChildren().length && api.choice.project.id === PROJECT2, "second product");
        await new Promise((r) => setTimeout(r, 2000)); // the slow PROJECT response arrives now
        const names = api.tree.getChildren().flatMap((n: any) => n.group.events.map((e: any) => e.name));
        assert.deepStrictEqual(names, ["admin_login"]);
      } finally {
        client.project = original;
        await vscode.commands.executeCommand("hodor.pickProject", PROJECT);
        await until(() => api.tree.getEvent && api.tree.getChildren().flatMap((n: any) => n.group.events).length === 3, "first product back");
      }
    });

    test("the details panel closes when the product changes", async () => {
      const first = api.tree.getChildren()[0].group.events[0];
      await vscode.commands.executeCommand("hodor.openEvent", first.id);
      const isOpen = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.label === first.name);
      await until(isOpen, "the details panel");
      await vscode.commands.executeCommand("hodor.pickProject", PROJECT2);
      await until(() => !isOpen(), "the panel to close");
      await vscode.commands.executeCommand("hodor.pickProject", PROJECT);
      await until(() => api.tree.getChildren().length, "first product back");
    });

    suite("AI chat (fake Claude)", () => {
      const WORKSPACE = process.env.HODOR_TEST_WORKSPACE!;
      const file = () => path.join(WORKSPACE, "src/signup.js");
      const ORIGINAL = "export function signup() {\n  createAccount();\n  // signup done\n}\n";
      const steps = () => api.chat.current.items.filter((i: any) => i.kind === "step");
      const setAutoApply = (on: boolean) =>
        vscode.workspace.getConfiguration("hodor").update("ai.autoApply", on, vscode.ConfigurationTarget.Global);

      /** Puts the file and signup_completed's status back as they were. */
      const restore = async () => {
        const doc = await vscode.workspace.openTextDocument(file());
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), ORIGINAL);
        await vscode.workspace.applyEdit(edit);
        await doc.save();
        await api.tree.refresh();
        const event = api.tree.getEventByName("signup_completed");
        if (event.status !== "not started") await api.session.client.setStatus(PROJECT, event.id, "not started", event.version);
        await api.tree.refresh();
        api.chat.reset();
      };

      suiteSetup(async function () {
        if (!WORKSPACE) this.skip();
        await vscode.commands.executeCommand("hodor.pickProject", PROJECT);
        await until(() => api.tree.getEventByName("signup_completed"), "events");
      });

      test("without a Claude key, the chat says AI is off and links to settings", async () => {
        await vscode.commands.executeCommand("hodor.pickProject", PROJECT2);
        await api.chat.send("FAKE:chat how many events?");
        const last = api.chat.current.items.at(-1);
        assert.strictEqual(last.text, "AI is off for this product. Ask your product owner to add a Claude key in Hodor settings.");
        assert.strictEqual(last.action, "settings");
        await vscode.commands.executeCommand("hodor.pickProject", PROJECT);
        await until(() => api.tree.getEventByName("signup_completed"), "events");
      });

      test("auto-apply: adds the event to the code and marks it implemented", async () => {
        await restore();
        await setAutoApply(true);
        await api.chat.send("FAKE:implement add the missing events");
        assert.strictEqual(api.chat.current.running, false);
        assert.match(fs.readFileSync(file(), "utf8"), /trackSignupCompleted\(\{ plan: "pro" \}\);\n  \/\/ signup done/);
        await api.tree.refresh();
        assert.strictEqual(api.tree.getEventByName("signup_completed").status, "implemented");
        const labels = steps().map((s: any) => s.label);
        assert.deepStrictEqual(labels, [
          'Getting "not started" events from Hodor',
          'Searching code for "signup"',
          "Reading src/signup.js",
          "Getting tracking code (JavaScript (Web))",
          "Editing src/signup.js: track signup_completed after the account is created",
          "Marking signup_completed implemented in Hodor",
        ]);
        assert.ok(steps().every((s: any) => s.status === "ok"), JSON.stringify(steps()));
        const text = api.chat.current.items.filter((i: any) => i.kind === "assistant").map((i: any) => i.text).join(" ");
        assert.match(text, /Added signup_completed/);
      });

      test("review mode: nothing changes until the developer applies", async () => {
        await restore();
        await setAutoApply(false);
        await api.chat.send("FAKE:implement add the missing events");
        assert.strictEqual(fs.readFileSync(file(), "utf8"), ORIGINAL);
        const edit = steps().find((s: any) => s.editId);
        assert.strictEqual(edit.editStatus, "proposed");
        await api.chat.applyChange(edit.editId);
        assert.match(fs.readFileSync(file(), "utf8"), /trackSignupCompleted/);
        await api.tree.refresh();
        assert.strictEqual(api.tree.getEventByName("signup_completed").status, "implemented");
      });

      test("a file changed after the AI read it is not overwritten", async () => {
        await restore();
        await setAutoApply(false);
        await api.chat.send("FAKE:implement add the missing events");
        const doc = await vscode.workspace.openTextDocument(file());
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), "// my own change\n");
        await vscode.workspace.applyEdit(edit);
        const proposal = steps().find((s: any) => s.editId);
        const result = await api.chat.applyChange(proposal.editId);
        assert.strictEqual(result.status, "failed");
        assert.strictEqual(result.reason, "the file changed since it was read");
        assert.ok(doc.getText().startsWith("// my own change"));
        assert.ok(!doc.getText().includes("trackSignupCompleted"));
        await vscode.commands.executeCommand("workbench.action.files.revert");
      });

      test("after Stop in the middle of a run, the next message still works", async () => {
        await restore();
        await setAutoApply(false);
        // Press Stop as soon as the chat starts reading a file.
        const watcher = api.chat.onDidChange((state: any) => {
          if (state.items.some((i: any) => i.kind === "step" && i.label.startsWith("Reading"))) api.chat.stop();
        });
        await api.chat.send("FAKE:implement add the missing events");
        watcher.dispose();
        assert.strictEqual(api.chat.current.items.at(-1).text, "Stopped. Changes made so far are kept.");
        await api.chat.send("FAKE:chat how many events are left?");
        const text = api.chat.current.items.filter((i: any) => i.kind === "assistant").map((i: any) => i.text).join(" ");
        assert.match(text, /You have 2 events not implemented/);
        assert.ok(!api.chat.current.items.some((i: any) => i.kind === "notice" && i.tone === "error"), JSON.stringify(api.chat.current.items));
      });

      test("New chat drops the old chat's proposed changes", async () => {
        await restore();
        await setAutoApply(false);
        await api.chat.send("FAKE:implement add the missing events");
        assert.ok(steps().some((s: any) => s.editStatus === "proposed"));
        api.chat.reset();
        await api.chat.applyAll();
        assert.strictEqual(fs.readFileSync(file(), "utf8"), ORIGINAL);
      });

      test("a command waits for Run, runs in the project with its output, then the agent carries on", async () => {
        await restore();
        await setAutoApply(true); // commands never run on their own, even with auto-apply
        const sent = api.chat.send("FAKE:command check node");
        const step = await until(() => steps().find((s: any) => s.command && s.commandState === "waiting"), "the command to wait");
        await new Promise((r) => setTimeout(r, 300));
        assert.strictEqual(steps().find((s: any) => s.id === step.id).commandState, "waiting");
        api.chat.decide(step.id, true);
        await sent;
        await setAutoApply(false);
        const done = steps().find((s: any) => s.id === step.id);
        assert.strictEqual(done.commandState, "done");
        assert.strictEqual(done.status, "ok");
        assert.match(done.output, /hello from command/);
        assert.ok(steps().some((s: any) => s.label === "Checking problems" && s.status === "ok"));
        assert.strictEqual(api.chat.current.items.at(-1).text, "Done. The command ran.");
      });

      test("a skipped command is not run and the agent is told", async () => {
        await restore();
        const sent = api.chat.send("FAKE:command check node");
        const step = await until(() => steps().find((s: any) => s.command && s.commandState === "waiting"), "the command to wait");
        api.chat.decide(step.id, false);
        await sent;
        const done = steps().find((s: any) => s.id === step.id);
        assert.strictEqual(done.commandState, "skipped");
        assert.strictEqual(done.output, undefined);
        assert.strictEqual(api.chat.current.items.at(-1).text, "Done. The command ran.");
      });

      test("Stop while a command waits answers it as not run", async () => {
        await restore();
        const sent = api.chat.send("FAKE:command check node");
        await until(() => steps().find((s: any) => s.command && s.commandState === "waiting"), "the command to wait");
        api.chat.stop();
        await sent;
        assert.strictEqual(api.chat.current.items.at(-1).text, "Stopped. Changes made so far are kept.");
        await api.chat.send("FAKE:chat still there?");
        assert.ok(!api.chat.current.items.some((i: any) => i.kind === "notice" && i.tone === "error"), JSON.stringify(api.chat.current.items));
      });

      test("when Claude's connection drops, the chat offers Retry", async () => {
        await restore();
        await api.chat.send("FAKE:slow");
        const last = api.chat.current.items.at(-1);
        assert.strictEqual(last.text, "Couldn't finish — try again.");
        assert.strictEqual(last.action, "retry");
        assert.strictEqual(api.chat.current.canRetry, true);
      });

      test("when the connection to Hodor drops mid-reply, Continue resumes from there", async () => {
        await restore();
        const client = api.session.client;
        const original = client.streamPost.bind(client);
        // The first reply breaks after one line, like a dropped Wi-Fi.
        client.streamPost = async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"type":"text","text":"Working"}\n'));
                controller.error(new TypeError("terminated"));
              },
            })
          );
        await api.chat.send("FAKE:chat how many events?");
        assert.strictEqual(api.chat.current.canContinue, true);
        assert.strictEqual(api.chat.current.items.at(-1).text, "Connection lost. Your changes so far are kept.");
        client.streamPost = original;
        await api.chat.resume();
        const text = api.chat.current.items.filter((i: any) => i.kind === "assistant").map((i: any) => i.text).join(" ");
        assert.match(text, /You have 2 events not implemented/);
        assert.strictEqual(api.chat.current.canContinue, false);
      });
    });

    // Last: signing out revokes the token the other tests use.
    suite("signing out", () => {
      test("sign out clears the product", async () => {
        await vscode.commands.executeCommand("hodor.signOut");
        assert.strictEqual(api.session.isSignedIn(), false);
        assert.strictEqual(api.choice.project, undefined);
      });
    });
  });
});
