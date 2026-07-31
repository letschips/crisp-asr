// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function ruleFor(selector: string): CSSStyleRule {
  const styleSheet = document.styleSheets.item(0);
  const rule = Array.from(styleSheet?.cssRules ?? []).find(
    (candidate) =>
      "selectorText" in candidate
      && candidate.selectorText === selector,
  );
  if (!rule) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return rule as CSSStyleRule;
}

describe("translucent window compatibility", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = readFileSync(
      resolve(projectRoot, "styles.css"),
      "utf8",
    );
    document.head.append(style);
  });

  it.each([
    ".crisp-asr-card",
    ".crisp-asr-live-strip",
  ])("does not create a nested compositor blur on %s", (selector) => {
    const declaration = ruleFor(selector).style;

    expect(declaration.getPropertyValue("backdrop-filter")).toBe("none");
    expect(declaration.getPropertyValue("-webkit-backdrop-filter")).toBe(
      "none",
    );
  });

  it("styles the new source controls, level meter and queue actions", () => {
    expect(
      ruleFor(".crisp-asr-source-controls").style.getPropertyValue("display"),
    ).toBe("grid");
    expect(
      ruleFor(".crisp-asr-field").style.getPropertyValue("display"),
    ).toBe("grid");
    expect(
      ruleFor(".crisp-asr-field").style.getPropertyValue(
        "grid-template-rows",
      ),
    ).toBe("20px 36px");
    expect(
      ruleFor(".crisp-asr-field select").style.getPropertyValue("height"),
    ).toBe("36px");
    expect(
      ruleFor(".crisp-asr-field select").style.getPropertyValue("min-height"),
    ).toBe("36px");
    expect(
      ruleFor(".crisp-asr-field__header").style.getPropertyValue("height"),
    ).toBe("20px");
    expect(
      ruleFor(
        ".crisp-asr-source-controls.is-computer-only .crisp-asr-field",
      ).style.getPropertyValue("grid-column"),
    ).toBe("1 / -1");
    expect(
      ruleFor(".crisp-asr-level__fill").style.getPropertyValue("transition"),
    ).toContain("width");
    expect(
      ruleFor(".crisp-asr-job__actions").style.getPropertyValue("display"),
    ).toBe("flex");
    expect(
      ruleFor(".crisp-asr-smart-actions").style.getPropertyValue("display"),
    ).toBe("grid");
  });
});
