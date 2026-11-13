// Two repos open as one multi-root workspace: every tool works across both,
// paths start with the folder's name, and the guard still applies in each.
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

suite("Several repos (multi-root workspace)", () => {
  let tools: any;

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "hodor" && e.packageJSON.publisher === "optiblack")!;
    const api: any = await ext.activate();
    tools = await api.repoTools();
  });

  test("both folders are open and described with their languages", () => {
    assert.deepStrictEqual(
      tools.guard.roots.map((r: any) => r.name),
      ["shop", "admin"]
    );
    const described = tools.describe();
    assert.match(described, /^shop\/ \(git; Node\/JavaScript\)$/m);
    assert.match(described, /^admin\/ \(Go\)$/m);
  });

  test("list, search and read work across both, with folder-name paths", async () => {
    assert.strictEqual(await tools.list(""), "shop/\nadmin/");
    const found = await tools.search("trackOrderPaid");
    assert.match(found, /^admin\/main\.go:3: /m);
    assert.match(found, /^shop\/src\/checkout\.js:2: /m);
    const scoped = await tools.search("trackOrderPaid", "admin/**/*.go");
    assert.ok(!scoped.includes("shop/"), scoped);
    const read = await tools.read("admin/main.go");
    assert.strictEqual(read.rel, "admin/main.go");
  });

  test("the guard still applies in each folder", async () => {
    await assert.rejects(tools.read("shop/.env"), /private file/);
    assert.strictEqual(tools.guard.writable("admin/.github/workflows/ci.yml").ok, false);
    const search = await tools.search("SECRET");
    assert.strictEqual(search, "No matches.");
  });

  test("commands run in the folder the AI names", () => {
    const multi = process.env.HODOR_TEST_MULTIROOT!;
    assert.strictEqual(fs.realpathSync(tools.cwd("admin")), fs.realpathSync(path.join(multi, "admin")));
    assert.throws(() => tools.cwd(), /Say which folder/);
  });
});
