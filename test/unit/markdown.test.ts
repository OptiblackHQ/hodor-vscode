import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../../src/markdown";

describe("parseInline", () => {
  it("finds `code` and **bold**", () => {
    expect(parseInline("run `npm i` **now** please")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "npm i" },
      { kind: "text", text: " " },
      { kind: "bold", text: "now" },
      { kind: "text", text: " please" },
    ]);
  });
  it("leaves HTML as text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists and code", () => {
    const blocks = parseMarkdown("## Signup\n\nAdd this:\nafter login\n\n```ts\nconst a = 1;\n\nb();\n```\n- one\n- two\n1. first\n2. second");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, inline: [{ kind: "text", text: "Signup" }] },
      { kind: "paragraph", inline: [{ kind: "text", text: "Add this:\nafter login" }] },
      { kind: "code", lang: "ts", text: "const a = 1;\n\nb();" },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]] },
    ]);
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
