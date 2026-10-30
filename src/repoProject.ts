// The product a repo is linked to, from the .hodor.json that `hodor init`
// writes at the repo root. Never throws: a bad file just means "not linked".

import { readFile } from "fs/promises";
import { join } from "path";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const readRepoProject = async (folders: string[]): Promise<string | null> => {
  for (const folder of folders) {
    try {
      const config = JSON.parse(await readFile(join(folder, ".hodor.json"), "utf8"));
      if (typeof config?.projectId === "string" && OBJECT_ID.test(config.projectId)) return config.projectId;
    } catch {
      // Missing or not JSON: try the next folder.
    }
  }
  return null;
};
