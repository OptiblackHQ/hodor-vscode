import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { readRepoProject } from "../../src/repoProject";

const ID = "64b7f0c2a1b2c3d4e5f60718";
const folder = (content?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "hodor-repo-"));
  if (content !== undefined) writeFileSync(join(dir, ".hodor.json"), content);
  return dir;
};

describe("readRepoProject", () => {
  it("reads the product id the CLI saved", async () => {
    expect(await readRepoProject([folder(JSON.stringify({ project: "App", projectId: ID, targets: [] }))])).toBe(ID);
  });

  it("returns null when there is no usable file", async () => {
    expect(await readRepoProject([folder()])).toBeNull();
    expect(await readRepoProject([folder("{not json")])).toBeNull();
    expect(await readRepoProject([folder(JSON.stringify({ projectId: "abc" }))])).toBeNull();
    expect(await readRepoProject([folder(JSON.stringify([ID]))])).toBeNull();
    expect(await readRepoProject([])).toBeNull();
  });

  it("uses the first folder with a valid file", async () => {
    const other = "aaaaaaaaaaaaaaaaaaaaaaaa";
    expect(await readRepoProject([folder("{bad"), folder(JSON.stringify({ projectId: ID })), folder(JSON.stringify({ projectId: other }))])).toBe(ID);
  });
});
