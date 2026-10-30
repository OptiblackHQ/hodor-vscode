import { HodorClient, HodorError, Status } from "./api";

export type StatusResult = { ok: true; version: number } | { ok: false; message: string; reload: boolean };

/** Changes an event's status from the version the editor last saw, with a message for each failure. */
export const changeStatus = async (
  client: Pick<HodorClient, "setStatus">,
  projectId: string,
  event: { id: string; name: string; version: number },
  status: Status
): Promise<StatusResult> => {
  try {
    const result = await client.setStatus(projectId, event.id, status, event.version);
    return { ok: true, version: result.version };
  } catch (error) {
    const code = error instanceof HodorError ? error.status : undefined;
    if (code === 409) return { ok: false, message: `${event.name} changed in Hodor. Reloaded — check it and try again.`, reload: true };
    if (code === 403) {
      return {
        ok: false,
        message: 'This sign-in is read-only. Sign out and sign in again, keeping "Allow changing event status" ticked.',
        reload: false,
      };
    }
    if (code === 404) return { ok: false, message: `${event.name} was deleted or moved in Hodor.`, reload: true };
    return { ok: false, message: error instanceof Error ? error.message : String(error), reload: false };
  }
};
