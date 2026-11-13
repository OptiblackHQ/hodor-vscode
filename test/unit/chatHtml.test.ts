import { describe, expect, it } from "vitest";
import { renderChatPage } from "../../src/chat/html";

describe("renderChatPage", () => {
  const html = renderChatPage({ nonce: "N0NCE", cspSource: "vscode-resource:" });
  it("runs scripts only with the nonce, under a strict CSP", () => {
    expect(html).toContain(`content="default-src 'none'; img-src data:; style-src vscode-resource: 'unsafe-inline'; script-src 'nonce-N0NCE'"`);
    for (const tag of html.match(/<script[^>]*>/g) || []) expect(tag).toContain('nonce="N0NCE"');
  });
  it("never parses chat content as HTML", () => {
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});

describe("the page script", () => {
  const html = renderChatPage({ nonce: "N0NCE", cspSource: "vscode-resource:" });
  const script = html.split(/<script[^>]*>/)[1].split("</script>")[0];
  it("parses", () => {
    expect(() => new Function(script)).not.toThrow();
  });
  it("doesn't redeclare the browser's own globals at the top level (that stops the whole page)", () => {
    const reserved = ["top", "parent", "self", "window", "frames", "location", "history", "name", "status", "length", "opener", "closed", "document"];
    const topLevel = script.split("\n").filter((l) => /^ {2}(const|let|var|function) /.test(l));
    for (const line of topLevel) {
      const declared = line.match(/^ {2}(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/)?.[1];
      expect(reserved).not.toContain(declared);
    }
  });
});
