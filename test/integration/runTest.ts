// Runs the integration suite in a real VS Code against a local Hodor:
//   HODOR_URL=http://localhost:3123 HODOR_TOKEN=<write token> HODOR_PROJECT=<id> npm run test:integration
// VSCODE_VERSION=1.85.2 runs it on the oldest VS Code the extension supports (Cursor is based on an older VS Code).
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

const main = async () => {
  const root = path.resolve(__dirname, "../../..");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hodor-ext-ws-"));
  try {
    await runTests({
      version: process.env.VSCODE_VERSION || "stable",
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, "suite/index.js"),
      launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
      extensionTestsEnv: { HODOR_TEST: "1" },
    });
  } catch {
    console.error("Integration tests failed");
    process.exit(1);
  }
};

void main();
