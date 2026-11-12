// Pure planning of the AI's changes (no VS Code), so it is unit tested.

export type Plan = { ok: true; next: string } | { ok: false; reason: string };

/** Replaces `oldText`, which must appear exactly once. Keeps the file's line endings. */
export const planEdit = (current: string, oldText: string, newText: string): Plan => {
  const crlf = current.includes("\r\n");
  const text = crlf ? current.replace(/\r\n/g, "\n") : current;
  const find = oldText.replace(/\r\n/g, "\n");
  const count = find ? text.split(find).length - 1 : 0;
  if (count === 0) return { ok: false, reason: "the text to replace was not found" };
  if (count > 1) return { ok: false, reason: `the text to replace appears ${count} times` };
  const next = text.replace(find, () => newText.replace(/\r\n/g, "\n"));
  return { ok: true, next: crlf ? next.replace(/\n/g, "\r\n") : next };
};

export const planCreate = (exists: boolean): { ok: true } | { ok: false; reason: string } =>
  exists ? { ok: false, reason: "the file already exists" } : { ok: true };
