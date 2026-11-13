// The AI models the chat can use: Claude's and the Gemini models the person's
// key allows, as Hodor reports them. Pure (no VS Code), so it is unit tested.

export type Provider = "claude" | "gemini";

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
}

export interface ProvidersInfo {
  claude: boolean;
  gemini: boolean;
  models?: { claude?: { id: string; label: string }[]; gemini?: { id: string; label: string }[] };
  defaults?: { claude?: string; gemini?: string };
}

const FALLBACK_CLAUDE = [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }];

export const providerOf = (model: string): Provider => (model.startsWith("gemini") ? "gemini" : "claude");

/** Every model this person can pick here, Claude first. */
export const modelOptions = (info: ProvidersInfo): ModelOption[] => [
  ...(info.claude ? (info.models?.claude?.length ? info.models.claude : FALLBACK_CLAUDE).map((m) => ({ ...m, provider: "claude" as const })) : []),
  ...(info.gemini ? (info.models?.gemini || []).map((m) => ({ ...m, provider: "gemini" as const })) : []),
];

/**
 * The model to use: the saved choice when it is still available; else the
 * saved provider's default; else the first available model.
 */
export const chooseModel = (info: ProvidersInfo, saved: string | undefined, savedProvider: Provider | undefined): ModelOption | null => {
  const options = modelOptions(info);
  if (!options.length) return null;
  const exact = saved && options.find((o) => o.id === saved);
  if (exact) return exact;
  const provider = saved ? providerOf(saved) : savedProvider;
  if (provider && info[provider]) {
    const preferred = info.defaults?.[provider];
    return options.find((o) => o.id === preferred) || options.find((o) => o.provider === provider) || options[0];
  }
  return options[0];
};

/** Short name for the input box: "Opus 5.5", "Gemini 3.8 Flash". */
export const shortLabel = (option: ModelOption): string => option.label.replace(/^Claude /, "").replace(/\s*\(.*\)$/, "");
