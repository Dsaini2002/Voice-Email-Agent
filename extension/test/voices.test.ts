import { describe, expect, it } from "vitest";
import { usefulVoices, voiceLabel } from "../src/shared";

const v = (name: string, lang: string) => ({ name, lang, default: false, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

describe("voice picker", () => {
  const all = [
    v("Microsoft David - English (United States)", "en-US"),
    v("Google français", "fr-FR"),
    v("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
    v("Google हिन्दी", "hi-IN"),
    v("Google UK English Female", "en-GB"),
  ];
  it("offers only English/Hindi voices, natural ones first", () => {
    const list = usefulVoices(all).map((x) => x.name);
    expect(list).not.toContain("Google français");
    expect(list[0]).toBe("Microsoft Neerja Online (Natural) - English (India)");
    expect(list).toHaveLength(4);
  });
  it("gives voices short friendly names", () => {
    expect(voiceLabel(all[2])).toBe("Neerja · English (India) · natural");
    expect(voiceLabel(all[0])).toBe("David · English (United States)");
  });
});
