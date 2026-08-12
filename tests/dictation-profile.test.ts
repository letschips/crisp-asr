import { describe, expect, it } from "vitest";
import {
  DICTATION_PROFILES,
  normalizeDictationProfileId,
  resolveDictationProfile,
} from "../src/dictation-profile";

describe("dictation profiles", () => {
  it("ships the seven agreed creation profiles", () => {
    expect(DICTATION_PROFILES.map((profile) => profile.id)).toEqual([
      "free", "idea", "article", "video", "xiaohongshu", "meeting", "custom",
    ]);
    expect(normalizeDictationProfileId("unknown")).toBe("free");
  });

  it("resolves custom profile text with safe fallbacks", () => {
    expect(resolveDictationProfile({
      id: "custom",
      customName: " 产品复盘 ",
      customContext: " 这是产品复盘 ",
      customInstruction: " 输出决策和行动项 ",
    })).toMatchObject({
      name: "产品复盘",
      context: "这是产品复盘",
      creationInstruction: "输出决策和行动项",
    });
  });
});
