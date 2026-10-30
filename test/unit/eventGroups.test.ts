import { describe, expect, it } from "vitest";
import { EventSummary } from "../../src/api";
import { groupEvents } from "../../src/eventGroups";

const ev = (name: string, status: EventSummary["status"], description = ""): EventSummary => ({
  id: name,
  name,
  description,
  category: "",
  status,
  platform: [],
  source: [],
  version: 0,
});

const events = [
  ev("zeta_done", "implemented"),
  ev("cart_viewed", "not started", "When the Cart page opens"),
  ev("alpha_started", "not started"),
  ev("checkout", "in progress", "Payment step"),
];

describe("groupEvents", () => {
  it("groups by status in workflow order, leaving out empty groups", () => {
    const groups = groupEvents(events, "");
    expect(groups.map((g) => [g.label, g.events.map((e) => e.name)])).toEqual([
      ["Not started", ["alpha_started", "cart_viewed"]],
      ["In progress", ["checkout"]],
      ["Implemented", ["zeta_done"]],
    ]);
  });

  it("searches names and descriptions, ignoring case and spaces around", () => {
    expect(groupEvents(events, "  CART page ").flatMap((g) => g.events.map((e) => e.name))).toEqual(["cart_viewed"]);
    expect(groupEvents(events, "payment").flatMap((g) => g.events.map((e) => e.name))).toEqual(["checkout"]);
    expect(groupEvents(events, "nothing like this")).toEqual([]);
  });

  it("handles a product with no events", () => {
    expect(groupEvents([], "")).toEqual([]);
  });
});
