// Small client for Hodor's /api/cli and /api/cli-auth endpoints (the same
// ones the Hodor CLI uses). No VS Code imports, so it is unit tested directly.

import type { ProvidersInfo } from "./chat/models";

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

const parseJson = (text: string): any => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

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

  /** Sends a request and throws Hodor's message for any error status. */
  private async send(
    method: string,
    path: string,
    { body, auth = true, signal }: { body?: unknown; auth?: boolean; signal?: AbortSignal } = {}
  ): Promise<Response> {
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
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new HodorError(`Can't reach Hodor (${this.base}). Check your internet connection.`);
    }
    if (res.ok) return res;
    if (res.status === 401 && auth) {
      this.opts.onUnauthorized?.();
      throw new HodorError("Your Hodor session ended. Sign in again.", 401);
    }
    const data = parseJson(await res.text());
    throw new HodorError(data?.error_description || data?.message || data?.error || `Hodor answered ${res.status}.`, res.status);
  }

  private async request<T>(method: string, path: string, options: { body?: unknown; auth?: boolean } = {}): Promise<T> {
    return parseJson(await (await this.send(method, path, options)).text()) as T;
  }

  /** POSTs and returns the response to read as a stream (the AI chat). */
  streamPost(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    return this.send("POST", path, { body, signal });
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

  /** Which AIs the chat can use for this product (the person's own keys, or the product's Claude key). */
  aiProviders(projectId: string): Promise<ProvidersInfo> {
    return this.request("GET", `/api/cli/projects/${encodeURIComponent(projectId)}/ai/providers`);
  }

  async setStatus(projectId: string, eventId: string, status: Status, version: number): Promise<{ status: Status; version: number }> {
    const path = `/api/cli/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(eventId)}/status`;
    const result = await this.request<{ status: Status; version: number }>("PATCH", path, { body: { status, version } });
    return { status: result.status, version: result.version };
  }
}
