// Waits for the person to approve a Hodor device login in the browser.
// Time and cancellation are passed in, so it is tested without waiting.

import { HodorClient, HodorError, LoginStart } from "./api";

export type LoginOutcome = { outcome: "approved"; token: string } | { outcome: "denied" | "expired" | "cancelled" };

export interface WaitOptions {
  isCancelled(): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const waitForApproval = async (
  client: Pick<HodorClient, "pollLogin">,
  start: Pick<LoginStart, "deviceCode" | "interval" | "expiresIn">,
  { isCancelled, sleep, now }: WaitOptions
): Promise<LoginOutcome> => {
  const deadline = now() + start.expiresIn * 1000;
  while (now() < deadline) {
    if (isCancelled()) return { outcome: "cancelled" };
    try {
      const answer = await client.pollLogin(start.deviceCode);
      if (answer.status === "approved" && answer.token) return { outcome: "approved", token: answer.token };
      if (answer.status === "denied") return { outcome: "denied" };
    } catch (error) {
      // Hodor forgets a login once it expires; anything else (a network blip) is retried.
      if (error instanceof HodorError && error.status === 404) return { outcome: "expired" };
    }
    if (isCancelled()) return { outcome: "cancelled" };
    await sleep(start.interval * 1000);
  }
  return { outcome: "expired" };
};
