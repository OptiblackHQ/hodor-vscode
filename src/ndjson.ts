import { HodorError } from "./api";

/** Newline-delimited JSON from a byte stream, one object per line. */
export async function* parseNdjson(chunks: AsyncIterable<Uint8Array>): AsyncIterable<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new HodorError("Hodor sent an unreadable reply.");
    }
  };
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parse(line);
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) yield parse(rest);
}
