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

const FALLBACK_CLAUDE = [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }];

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

/**
 * The model a new chat starts on: the one the person picked last, when it is
 * still there; with no pick yet, Gemini when they have a Gemini key.
 */
export const newChatModel = (info: ProvidersInfo, saved: string | undefined, savedProvider: Provider | undefined): ModelOption | null => {
  const options = modelOptions(info);
  const exact = saved && options.find((o) => o.id === saved);
  if (exact) return exact;
  if (!saved && options.some((o) => o.provider === "gemini")) return chooseModel(info, undefined, "gemini");
  return chooseModel(info, saved, savedProvider);
};

/** The Claude model to continue with when Gemini's free limit runs out: Haiku, else Claude's default. */
export const claudeFallback = (info: ProvidersInfo): ModelOption | null => {
  if (!info.claude) return null;
  const claude = modelOptions(info).filter((o) => o.provider === "claude");
  return claude.find((o) => /haiku/.test(o.id)) || claude.find((o) => o.id === info.defaults?.claude) || claude[0] || null;
};

/** Short name for the input box: "Opus 5.5", "Gemini 3.8 Flash". */
export const shortLabel = (option: ModelOption): string => option.label.replace(/^Claude /, "").replace(/\s*\(.*\)$/, "");
