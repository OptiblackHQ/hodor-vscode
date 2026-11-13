import * as path from "path";
import Mocha from "mocha";

export const run = (): Promise<void> => {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30000 });
  // A multi-root workspace runs only the folder tests (no Hodor needed).
  mocha.addFile(path.resolve(__dirname, process.env.HODOR_TEST_MULTIROOT ? "multiroot.test.js" : "extension.test.js"));
  return new Promise((resolve, reject) =>
    mocha.run((failures) => (failures ? reject(new Error(`${failures} tests failed`)) : resolve()))
  );
};
