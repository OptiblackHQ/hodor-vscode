import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../../src/markdown";

describe("parseInline", () => {
  it("finds `code`, **bold**, *italic* and links", () => {
    expect(parseInline("run `npm i` **now**, *really* and see [docs](https://hodor.optiblack.com/cli)")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "npm i" },
      { kind: "text", text: " " },
      { kind: "bold", text: "now" },
      { kind: "text", text: ", " },
      { kind: "italic", text: "really" },
      { kind: "text", text: " and see " },
      { kind: "link", text: "docs", href: "https://hodor.optiblack.com/cli" },
    ]);
  });
  it("leaves HTML, javascript: links and snake_case alone", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
    expect(parseInline("signup_completed and order_paid_v2")).toEqual([{ kind: "text", text: "signup_completed and order_paid_v2" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists and code", () => {
    const blocks = parseMarkdown("## Signup\n\nAdd this:\nafter login\n\n```ts\nconst a = 1;\n\nb();\n```\n- one\n- two\n1. first\n2. second");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, inline: [{ kind: "text", text: "Signup" }] },
      { kind: "paragraph", inline: [{ kind: "text", text: "Add this:\nafter login" }] },
      { kind: "code", lang: "ts", text: "const a = 1;\n\nb();" },
      { kind: "list", ordered: false, items: [{ inline: [{ kind: "text", text: "one" }], depth: 0 }, { inline: [{ kind: "text", text: "two" }], depth: 0 }] },
      { kind: "list", ordered: true, items: [{ inline: [{ kind: "text", text: "first" }], depth: 0 }, { inline: [{ kind: "text", text: "second" }], depth: 0 }] },
    ]);
  });
  it("nests list items by indentation", () => {
    const [list] = parseMarkdown("1. Plan\n   - read code\n   - edit\n2. Check");
    expect(list).toMatchObject({ kind: "list", ordered: true });
    expect((list as any).items.map((i: any) => i.depth)).toEqual([0, 1, 1, 0]);
  });
  it("reads tables and quotes", () => {
    const blocks = parseMarkdown("| Event | Status |\n|---|:--:|\n| signup | `done` |\n| order | left |\n\n> note one\n> note two");
    expect(blocks[0]).toEqual({
      kind: "table",
      header: [[{ kind: "text", text: "Event" }], [{ kind: "text", text: "Status" }]],
      rows: [
        [[{ kind: "text", text: "signup" }], [{ kind: "code", text: "done" }]],
        [[{ kind: "text", text: "order" }], [{ kind: "text", text: "left" }]],
      ],
    });
    expect(blocks[1]).toEqual({ kind: "quote", inline: [{ kind: "text", text: "note one" }, { kind: "text", text: "\n" }, { kind: "text", text: "note two" }] });
  });
  it("shows an unclosed code block while it streams", () => {
    expect(parseMarkdown("Here:\n```js\nfoo(")).toEqual([
      { kind: "paragraph", inline: [{ kind: "text", text: "Here:" }] },
      { kind: "code", lang: "js", text: "foo(" },
    ]);
  });
  it("keeps Windows line endings out of the text", () => {
    expect(parseMarkdown("a\r\nb")).toEqual([{ kind: "paragraph", inline: [{ kind: "text", text: "a\nb" }] }]);
  });
});
