import { describe, expect, it } from "vitest";
import { CRISP_LICENSE_PRODUCTS } from "../src/license";

describe("Crisp suite product compatibility", () => {
  it("recognizes the complete current product family", () => {
    expect(CRISP_LICENSE_PRODUCTS).toEqual(expect.arrayContaining([
      "Crisp Suite",
      "Crisp Organize",
      "Crisp ASR",
      "Crisp Annotations",
      "Crisp File Explorer",
      "Crisp Focus",
      "Crisp Reading Rail",
      "Crisp Base",
    ]));
  });
});
