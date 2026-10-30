import { CodeResult } from "./api";

// Hodor's language ids and labels (src/lib/codegen/languages in the hodor repo).
const LABELS: Record<string, string> = {
  javascript: "JavaScript (Web)",
  node: "Node.js",
  "react-native": "React Native",
  flutter: "Flutter",
  kotlin: "Kotlin (Android)",
  swift: "Swift (iOS)",
  php: "PHP",
  python: "Python",
  go: "Go",
  http: "HTTP API",
};

export const languageLabel = (id: string): string => LABELS[id] || id;

/**
 * One event's tracking function, followed by its example call as a comment
 * (as in Hodor's downloaded file), so pasting it never runs the call by itself.
 */
export const eventSnippet = (code: CodeResult, eventName: string): string | null => {
  const f = code.functions.find((fn) => fn.eventName === eventName);
  if (!f) return null;
  const comment = code.language === "python" ? "#" : "//";
  const example = ["Call it like this where the event happens:", ...f.exampleCall.split("\n")]
    .map((line) => `${comment} ${line}`.trimEnd())
    .join("\n");
  return `${f.code}\n\n${example}`;
};
