import { describe, expect, it } from "vitest";
import { HodorError } from "../../src/api";
import { parseNdjson } from "../../src/ndjson";

const chunks = async function* (...parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
};

const collect = async (it: AsyncIterable<unknown>) => {
  const out: unknown[] = [];
  for await (const v of it) out.push(v);
  return out;
};

describe("parseNdjson", () => {
  it("joins lines split across chunks and skips blank lines", async () => {
    expect(await collect(parseNdjson(chunks('{"a":1}\n{"b":', '2}\n\n{"c":3}\n')))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("reads a last line without a newline", async () => {
    expect(await collect(parseNdjson(chunks('{"a":1}\n{"b":2}')))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("handles multi-byte characters split between chunks", async () => {
    const bytes = new TextEncoder().encode('{"t":"—"}\n');
    const gen = async function* () {
      yield bytes.slice(0, 7);
      yield bytes.slice(7);
    };
    expect(await collect(parseNdjson(gen()))).toEqual([{ t: "—" }]);
  });

  it("rejects a line that is not JSON", async () => {
    await expect(collect(parseNdjson(chunks("<html>\n")))).rejects.toEqual(new HodorError("Hodor sent an unreadable reply."));
  });
});
