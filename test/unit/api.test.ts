import { describe, expect, it, vi } from "vitest";
import { HodorClient, HodorError, STATUSES } from "../../src/api";

type Call = { url: string; init: RequestInit };

const fakeFetch = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const headers = (call: Call) => call.init.headers as Record<string, string>;

const client = (fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof HodorClient>[0]> = {}) =>
  new HodorClient({ serverUrl: "https://hodor.test/", token: "hodor_pat_x", version: "0.1.0", fetch: fetchFn, ...extra });

describe("HodorClient", () => {
  it("lists statuses in workflow order", () => {
    expect(STATUSES).toEqual(["not started", "ready to implement", "in progress", "implemented"]);
  });

  it("sends the token and its user agent, without a double slash", async () => {
    const f = fakeFetch(() => json(200, { projects: [{ id: "p", name: "App" }] }));
    expect(await client(f.fn).projects()).toEqual([{ id: "p", name: "App" }]);
    expect(f.calls[0].url).toBe("https://hodor.test/api/cli/projects");
    expect(headers(f.calls[0]).Authorization).toBe("Bearer hodor_pat_x");
    expect(headers(f.calls[0])["User-Agent"]).toBe("hodor-vscode/0.1.0");
  });

  it("starts the login asking for write access, without a token", async () => {
    const f = fakeFetch(() => json(201, { deviceCode: "d", userCode: "ABCD-EFGH", verificationUrl: "u", expiresIn: 600, interval: 2 }));
    await client(f.fn).startLogin("Cursor on mac");
    expect(f.calls[0].url).toBe("https://hodor.test/api/cli-auth/start");
    expect(headers(f.calls[0]).Authorization).toBeUndefined();
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ clientName: "Cursor on mac", requestWrite: true });
  });

  it("polls without a token", async () => {
    const f = fakeFetch(() => json(200, { status: "pending" }));
    expect(await client(f.fn).pollLogin("d")).toEqual({ status: "pending" });
    expect(headers(f.calls[0]).Authorization).toBeUndefined();
  });

  it("reports an ended session once and throws 401", async () => {
    const onUnauthorized = vi.fn();
    const f = fakeFetch(() => json(401, { error: "invalid_token" }));
    const error = await client(f.fn, { onUnauthorized }).projects().catch((e) => e);
    expect(error).toBeInstanceOf(HodorError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Your Hodor session ended. Sign in again.");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("uses Hodor's error message, or the status when the body is not JSON", async () => {
    const a = await client(fakeFetch(() => json(409, { error: "Changed meanwhile" })).fn).projects().catch((e) => e);
    expect([a.message, a.status]).toEqual(["Changed meanwhile", 409]);
    const b = await client(fakeFetch(() => new Response("<html>", { status: 502 })).fn).projects().catch((e) => e);
    expect([b.message, b.status]).toEqual(["Hodor answered 502.", 502]);
  });

  it("explains a network failure", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const error = await client(f.fn).projects().catch((e) => e);
    expect(error).toBeInstanceOf(HodorError);
    expect(error.status).toBeUndefined();
    expect(error.message).toBe("Can't reach Hodor (https://hodor.test). Check your internet connection.");
  });

  it("updates status with PATCH and the version it started from", async () => {
    const f = fakeFetch(() => json(200, { id: "e", name: "x", status: "implemented", version: 4 }));
    expect(await client(f.fn).setStatus("p", "e", "implemented", 3)).toEqual({ status: "implemented", version: 4 });
    expect(f.calls[0].url).toBe("https://hodor.test/api/cli/projects/p/events/e/status");
    expect(f.calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ status: "implemented", version: 3 });
  });

  it("unwraps project, event and code responses", async () => {
    const f = fakeFetch(({ url }) => {
      if (url.endsWith("/events/e")) return json(200, { event: { id: "e", name: "x" } });
      if (url.includes("/code?language=go")) return json(200, { file: "package analytics", functions: [] });
      return json(200, { project: { id: "p" }, events: [] });
    });
    const c = client(f.fn);
    expect(await c.project("p")).toEqual({ project: { id: "p" }, events: [] });
    expect(await c.event("p", "e")).toEqual({ id: "e", name: "x" });
    expect((await c.code("p", "go")).file).toBe("package analytics");
  });
});
