import { describe, expect, it } from "vitest";
import { EventDetails } from "../../src/api";
import { escapeHtml, renderDetails } from "../../src/detailsHtml";

const event: EventDetails = {
  id: "e1",
  name: '<img src=x onerror=alert(1)>',
  description: `Fires "after" sign-up & 'save'`,
  status: "in progress",
  version: 3,
  platform: ["Web"],
  source: ["Javascript"],
  event_properties: [{ name: "plan", description: "Plan <b>name</b>", data_type: "String", sample_value: { tier: "<pro>" } }],
  super_properties: [],
  user_properties: [],
};

const html = renderDetails(event, {
  languages: [{ id: "javascript", label: "JavaScript (Web)" }, { id: "node", label: "Node.js" }],
  selectedLanguage: "node",
  nonce: "N0NCE",
  cspSource: "vscode-resource:",
});

describe("renderDetails", () => {
  it("escapes everything people typed in Hodor", () => {
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>name</b>");
    expect(html).toContain("&quot;after&quot; sign-up &amp; &#39;save&#39;");
    expect(html).toContain("&lt;pro&gt;");
  });

  it("only runs scripts with the nonce, under a strict CSP", () => {
    expect(html).toContain(`content="default-src 'none'; style-src vscode-resource: 'unsafe-inline'; script-src 'nonce-N0NCE'"`);
    const scripts = html.match(/<script[^>]*>/g) || [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain('nonce="N0NCE"');
  });

  it("shows status, the selected language and only non-empty property groups", () => {
    expect(html).toMatch(/<option value="in progress" selected>/);
    expect(html).toMatch(/<option value="node" selected>Node.js<\/option>/);
    expect(html).toContain("Event properties");
    expect(html).not.toContain("Super properties");
    expect(html).toContain("Copy code");
    expect(html).toContain("Copy full file");
    expect(html).toContain("Open in Hodor");
  });

  it("escapeHtml handles non-strings", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(5)).toBe("5");
  });
});
