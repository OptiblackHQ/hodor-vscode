import { describe, expect, it, vi } from "vitest";
import { HodorError } from "../../src/api";
import { changeStatus } from "../../src/status";

const event = { id: "e1", name: "cart_viewed", version: 3 };
const failing = (error: Error) => ({ setStatus: vi.fn(async () => Promise.reject(error)) });

describe("changeStatus", () => {
  it("returns the new version on success", async () => {
    const client = { setStatus: vi.fn(async () => ({ status: "implemented" as const, version: 4 })) };
    expect(await changeStatus(client, "p1", event, "implemented")).toEqual({ ok: true, version: 4 });
    expect(client.setStatus).toHaveBeenCalledWith("p1", "e1", "implemented", 3);
  });

  it("reloads when someone changed the event in Hodor", async () => {
    expect(await changeStatus(failing(new HodorError("x", 409)), "p1", event, "implemented")).toEqual({
      ok: false,
      message: "cart_viewed changed in Hodor. Reloaded — check it and try again.",
      reload: true,
    });
  });

  it("explains a read-only sign-in", async () => {
    expect(await changeStatus(failing(new HodorError("This sign-in is read-only.", 403)), "p1", event, "implemented")).toEqual({
      ok: false,
      message: 'This sign-in is read-only. Sign out and sign in again, keeping "Allow changing event status" ticked.',
      reload: false,
    });
  });

  it("reloads when the event is gone", async () => {
    expect(await changeStatus(failing(new HodorError("Event not found.", 404)), "p1", event, "implemented")).toEqual({
      ok: false,
      message: "cart_viewed was deleted or moved in Hodor.",
      reload: true,
    });
  });

  it("passes other errors through", async () => {
    expect(await changeStatus(failing(new HodorError("Can't reach Hodor")), "p1", event, "implemented")).toEqual({
      ok: false,
      message: "Can't reach Hodor",
      reload: false,
    });
  });
});
