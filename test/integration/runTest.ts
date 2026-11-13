// Runs the integration suite in a real VS Code against a local Hodor:
//   HODOR_URL=http://localhost:3123 HODOR_TOKEN=<write token> HODOR_PROJECT=<id> npm run test:integration
// VSCODE_VERSION=1.85.2 runs it on the oldest VS Code the extension supports (Cursor is based on an older VS Code).
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

export const SIGNUP_JS = "export function signup() {\n  createAccount();\n  // signup done\n}\n";

const main = async () => {
  const root = path.resolve(__dirname, "../../..");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hodor-ext-ws-"));
  // A tiny project for the chat tests to edit.
  fs.mkdirSync(path.join(workspace, "src"));
  fs.writeFileSync(path.join(workspace, "src/signup.js"), SIGNUP_JS);
  fs.writeFileSync(path.join(workspace, ".env"), "SECRET=do-not-read\n");
  // Two repos opened as one multi-root workspace.
  const multi = fs.mkdtempSync(path.join(os.tmpdir(), "hodor-ext-multi-"));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(multi, rel)), { recursive: true });
    fs.writeFileSync(path.join(multi, rel), text);
  };
  write("shop/package.json", '{ "name": "shop" }\n');
  write("shop/.git/HEAD", "ref: refs/heads/main\n");
  write("shop/src/checkout.js", "export function checkout() {\n  // trackOrderPaid here\n}\n");
  write("shop/.env", "SECRET=no\n");
  write("admin/go.mod", "module admin\n");
  write("admin/main.go", "package main\n\n// trackOrderPaid in admin too\nfunc main() {}\n");
  write("admin/.github/workflows/ci.yml", "on: push\n");
  const workspaceFile = path.join(multi, "all.code-workspace");
  fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [{ path: "shop" }, { path: "admin" }] }));
  const run = (launch: string, env: Record<string, string>) =>
    runTests({
      version: process.env.VSCODE_VERSION || "stable",
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, "suite/index.js"),
      launchArgs: [launch, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
      extensionTestsEnv: { HODOR_TEST: "1", ...env },
    });
  try {
    await run(workspace, { HODOR_TEST_WORKSPACE: workspace });
    await run(workspaceFile, { HODOR_TEST_MULTIROOT: multi });
  } catch {
    console.error("Integration tests failed");
    process.exit(1);
  }
};

void main();
