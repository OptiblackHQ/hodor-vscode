import { describe, expect, it } from "vitest";
import { CodeResult } from "../../src/api";
import { eventSnippet, languageLabel } from "../../src/snippet";

const code = (language: string, exampleCall: string) =>
  ({
    language,
    functions: [{ eventName: "cart_viewed", functionName: "trackCartViewed", code: "def track_cart_viewed(): ...", exampleCall }],
  }) as CodeResult;

describe("eventSnippet", () => {
  it("returns the event's function with the example call commented out", () => {
    expect(eventSnippet(code("javascript", "trackCartViewed({\n  plan: 'pro',\n});"), "cart_viewed")).toBe(
      "def track_cart_viewed(): ...\n\n// Call it like this where the event happens:\n// trackCartViewed({\n//   plan: 'pro',\n// });"
    );
  });

  it("uses # comments for Python", () => {
    expect(eventSnippet(code("python", "track_cart_viewed()"), "cart_viewed")).toBe(
      "def track_cart_viewed(): ...\n\n# Call it like this where the event happens:\n# track_cart_viewed()"
    );
  });

  it("returns null when the event is not in the generated code", () => {
    expect(eventSnippet(code("go", "x"), "missing")).toBeNull();
  });

  it("labels languages like Hodor does", () => {
    expect(languageLabel("react-native")).toBe("React Native");
    expect(languageLabel("unknown")).toBe("unknown");
  });
});
