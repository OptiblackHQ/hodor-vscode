import { EventSummary, Status, STATUSES } from "./api";

export interface EventGroup {
  status: Status;
  label: string;
  events: EventSummary[];
}

const LABELS: Record<Status, string> = {
  "not started": "Not started",
  "ready to implement": "Ready to implement",
  "in progress": "In progress",
  implemented: "Implemented",
};

export const statusLabel = (status: Status): string => LABELS[status] || status;

/** Events matching `query` (name or description), grouped by status in workflow order. */
export const groupEvents = (events: EventSummary[], query: string): EventGroup[] => {
  const q = query.trim().toLowerCase();
  const matching = q
    ? events.filter((e) => e.name.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q))
    : events;
  return STATUSES.map((status) => ({
    status,
    label: LABELS[status],
    events: matching.filter((e) => e.status === status).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.events.length);
};
