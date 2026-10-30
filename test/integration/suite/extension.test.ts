import * as assert from "assert";
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

    test("sign out clears the product", async () => {
      await vscode.commands.executeCommand("hodor.signOut");
      assert.strictEqual(api.session.isSignedIn(), false);
      assert.strictEqual(api.choice.project, undefined);
    });
  });
});
