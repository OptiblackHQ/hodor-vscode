// A small Markdown reader for the chat's answers: headings, paragraphs, lists
// (nested), quotes, tables, fenced code, and inline `code`, **bold**, *italic*
// and [links](https://…). It returns plain data, which the chat page draws
// with textContent, so nothing in an answer is parsed as HTML.
// Pure (no VS Code), so it is unit tested.

export type Inline = { kind: "text" | "code" | "bold" | "italic"; text: string } | { kind: "link"; text: string; href: string };

export interface ListItem {
  inline: Inline[];
  /** 0 for top level, 1 for one step in, … */
  depth: number;
}

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; inline: Inline[] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "code"; lang: string; text: string };

/** `code`, **bold**, *italic* / _italic_ and [text](http…) inside one line of text. */
export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])/g;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "bold", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", text: m[3], href: m[4] });
    else out.push({ kind: "italic", text: m[5] ?? m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
};

const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export const parseMarkdown = (source: string): Block[] => {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body: string[] = [];
      // An unclosed fence (still streaming) runs to the end.
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push({ kind: "code", lang: fence[2] || "", text: body.join("\n") });
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const header = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(cells(lines[i]).map(parseInline));
      i--;
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, inline: parseInline(heading[2]) });
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "quote") prev.inline.push({ kind: "text", text: "\n" }, ...parseInline(quote[1]));
      else blocks.push({ kind: "quote", inline: parseInline(quote[1]) });
      continue;
    }
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      flush();
      const m = (bullet || numbered)!;
      const ordered = Boolean(numbered);
      const depth = Math.min(4, Math.floor(m[1].replace(/\t/g, "  ").length / 2));
      const item = { inline: parseInline(m[2]), depth };
      const prev = blocks[blocks.length - 1];
      // Nested items join the list they are under, whatever their own marker.
      if (prev?.kind === "list" && (prev.ordered === ordered || depth > 0)) prev.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
};
