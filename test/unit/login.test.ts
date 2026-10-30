import { describe, expect, it, vi } from "vitest";
import { HodorError } from "../../src/api";
import { waitForApproval } from "../../src/login";

const start = { deviceCode: "d", interval: 2, expiresIn: 600 };

/** A fake clock: sleep advances time instead of waiting. */
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)) };
};

const polls = (...answers: (object | Error)[]) => {
  const pollLogin = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) throw next;
    return next as { status: "pending" | "denied" | "approved"; token?: string };
  });
  return { pollLogin };
};

describe("waitForApproval", () => {
  it("polls every interval until approved and returns the token", async () => {
    const c = clock();
    const client = polls({ status: "pending" }, { status: "pending" }, { status: "approved", token: "hodor_pat_x" });
    const result = await waitForApproval(client, start, { ...c, isCancelled: () => false });
    expect(result).toEqual({ outcome: "approved", token: "hodor_pat_x" });
    expect(client.pollLogin).toHaveBeenCalledTimes(3);
    expect(c.sleep).toHaveBeenCalledWith(2000);
  });

  it("stops at the first denial", async () => {
    const client = polls({ status: "denied" });
    expect(await waitForApproval(client, start, { ...clock(), isCancelled: () => false })).toEqual({ outcome: "denied" });
  });

  it("expires when the time runs out", async () => {
    const client = polls({ status: "pending" });
    expect(await waitForApproval(client, start, { ...clock(), isCancelled: () => false })).toEqual({ outcome: "expired" });
    expect(client.pollLogin.mock.calls.length).toBeLessThanOrEqual(300);
  });

  it("expires when Hodor no longer knows the login (404)", async () => {
    const client = polls(new HodorError("This login expired.", 404));
    expect(await waitForApproval(client, start, { ...clock(), isCancelled: () => false })).toEqual({ outcome: "expired" });
    expect(client.pollLogin).toHaveBeenCalledTimes(1);
  });

  it("stops without polling again once cancelled", async () => {
    let cancelled = false;
    const client = polls({ status: "pending" });
    client.pollLogin.mockImplementationOnce(async () => {
      cancelled = true;
      return { status: "pending" };
    });
    const result = await waitForApproval(client, start, { ...clock(), isCancelled: () => cancelled });
    expect(result).toEqual({ outcome: "cancelled" });
    expect(client.pollLogin).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through network blips", async () => {
    const client = polls(new HodorError("Can't reach Hodor"), { status: "approved", token: "t" });
    expect(await waitForApproval(client, start, { ...clock(), isCancelled: () => false })).toEqual({ outcome: "approved", token: "t" });
  });
});
