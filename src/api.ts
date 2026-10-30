// Small client for Hodor's /api/cli and /api/cli-auth endpoints (the same
// ones the Hodor CLI uses). No VS Code imports, so it is unit tested directly.

export type Status = "not started" | "ready to implement" | "in progress" | "implemented";

/** Workflow order, as Hodor lists them. */
export const STATUSES: Status[] = ["not started", "ready to implement", "in progress", "implemented"];

export interface Project {
  id: string;
  name: string;
  description?: string;
  analytics_provider: string;
  languages: string[];
  total_events?: number;
}

export interface EventSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  status: Status;
  platform: string[];
  source: string[];
  version: number;
}

export interface Property {
  name: string;
  description: string;
  data_type: string;
  sample_value: unknown;
}

export interface EventDetails {
  id: string;
  name: string;
  description: string;
  status: Status;
  version: number;
  platform: string[];
  source: string[];
  event_properties: Property[];
  super_properties: Property[];
  user_properties: Property[];
  [key: string]: unknown;
}

export interface CodeResult {
  language: string;
  languageLabel: string;
  filename: string;
  install: string;
  importLine: string;
  file: string;
  functions: { eventName: string; functionName: string; code: string; exampleCall: string }[];
}

export interface LoginStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export class HodorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "HodorError";
  }
}

export interface ClientOptions {
  serverUrl: string;
  token?: string;
  version: string;
  fetch?: typeof fetch;
  /** Called when Hodor rejects the token (expired or revoked). */
  onUnauthorized?: () => void;
}

export class HodorClient {
  private readonly base: string;

  constructor(private readonly opts: ClientOptions) {
    this.base = opts.serverUrl.replace(/\/+$/, "");
  }

  get serverUrl(): string {
    return this.base;
  }

  private async request<T>(method: string, path: string, { body, auth = true }: { body?: unknown; auth?: boolean } = {}): Promise<T> {
    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(this.base + path, {
        method,
        headers: {
          Accept: "application/json",
          "User-Agent": `hodor-vscode/${this.opts.version}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(auth && this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new HodorError(`Can't reach Hodor (${this.base}). Check your internet connection.`);
    }
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      if (res.status === 401 && auth) {
        this.opts.onUnauthorized?.();
        throw new HodorError("Your Hodor session ended. Sign in again.", 401);
      }
      throw new HodorError(data?.error_description || data?.message || data?.error || `Hodor answered ${res.status}.`, res.status);
    }
    return data as T;
  }

  startLogin(clientName: string): Promise<LoginStart> {
    return this.request("POST", "/api/cli-auth/start", { auth: false, body: { clientName, requestWrite: true } });
  }

  pollLogin(deviceCode: string): Promise<{ status: "pending" | "denied" | "approved"; token?: string }> {
    return this.request("POST", "/api/cli-auth/poll", { auth: false, body: { deviceCode } });
  }

  me(): Promise<{ email: string; access: "read" | "write" }> {
    return this.request("GET", "/api/cli/me");
  }

  async revoke(): Promise<void> {
    await this.request("DELETE", "/api/cli/me");
  }

  async projects(): Promise<Project[]> {
    return (await this.request<{ projects: Project[] }>("GET", "/api/cli/projects")).projects;
  }

  project(id: string): Promise<{ project: Project; events: EventSummary[] }> {
    return this.request("GET", `/api/cli/projects/${encodeURIComponent(id)}`);
  }

  async event(projectId: string, eventId: string): Promise<EventDetails> {
    const path = `/api/cli/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}`;
    return (await this.request<{ event: EventDetails }>("GET", path)).event;
  }

  code(projectId: string, language: string): Promise<CodeResult> {
    return this.request("GET", `/api/cli/projects/${encodeURIComponent(projectId)}/code?language=${encodeURIComponent(language)}`);
  }

  async setStatus(projectId: string, eventId: string, status: Status, version: number): Promise<{ status: Status; version: number }> {
    const path = `/api/cli/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}/status`;
    const result = await this.request<{ status: Status; version: number }>("PATCH", path, { body: { status, version } });
    return { status: result.status, version: result.version };
  }
}
