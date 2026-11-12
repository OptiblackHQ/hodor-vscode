// The AI chat's request to Hodor: posts the conversation and reads the reply
// as it streams (text, Hodor-side tool progress, then "done" or "error").

import { HodorClient } from "./api";
import { parseNdjson } from "./ndjson";

/** The conversation is kept exactly as Hodor returns it (Claude's message format). */
export type ChatMessage = { role: "user" | "assistant"; content: unknown };

export interface PendingTool {
  id: string;
  name: "search_code" | "list_files" | "read_file" | "propose_edit" | "create_file";
  input: Record<string, any>;
}

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "server_tool"; name: string; input: Record<string, any>; ok: boolean }
  | {
      type: "done";
      messages: ChatMessage[];
      pending: PendingTool[];
      serverResults: ToolResult[];
      stop: "end" | "tools" | "refusal" | "max_tokens" | "limit";
      usage: { input: number; output: number };
    }
  | { type: "error"; code: "bad_key" | "limit" | "overloaded" | "refusal"; message: string };

async function* bodyChunks(res: Response): AsyncIterable<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

export async function* aiTurn(
  client: HodorClient,
  projectId: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncIterable<TurnEvent> {
  const res = await client.streamPost(`/api/cli/projects/${encodeURIComponent(projectId)}/ai/turn`, { messages }, signal);
  for await (const event of parseNdjson(bodyChunks(res))) yield event as TurnEvent;
}
