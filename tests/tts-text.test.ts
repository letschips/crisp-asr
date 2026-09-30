import { describe, expect, it } from "vitest";
import { markdownFromLine, markdownToSpeechText, splitSpeechChunks } from "../src/tts-text";

describe("markdownToSpeechText", () => {
  it("drops frontmatter, fenced code, math blocks and comments", () => {
    const md = [
      "---",
      "title: \"测试: 标题\"",
      "tags: [a]",
      "---",
      "# 标题",
      "",
      "正文第一段。",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "%% 私人注释 %%",
      "<!-- html comment -->",
      "结尾。",
    ].join("\n");
    const text = markdownToSpeechText(md);
    expect(text).toContain("标题");
    expect(text).toContain("正文第一段。");
    expect(text).toContain("结尾。");
    for (const gone of ["title", "const x", "mc^2", "私人注释", "html comment", "---", "#"]) {
      expect(text).not.toContain(gone);
    }
  });

  it("keeps link display text and removes embeds, images and urls", () => {
    const md = "看 [[Note A|别名]] 和 [[Note B#小节]] 以及 [官网](https://x.com)。![[pic.png]] ![图](a.png) 访问 https://example.com 了解。";
    expect(markdownToSpeechText(md)).toBe("看 别名 和 Note B 以及 官网。 访问 了解。");
  });

  it("never passes angle brackets through, because Gemini 3.8 reads them as vocal tags", () => {
    const text = markdownToSpeechText("出现 <div class=\"note\"> 标签 </div>，还有 a < b 和 b > a。");
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("出现");
    expect(text).not.toContain("div");
  });

  it("strips inline markup, list, quote and callout markers", () => {
    const md = [
      "> [!note] 提示标题",
      "> 引用内容 **加粗** 和 ==高亮== 和 ~~删除~~ 和 `code`",
      "- 列表项 #tag",
      "1. 有序项[^1]",
      "- [ ] 待办",
      "",
      "[^1]: 脚注内容",
    ].join("\n");
    const text = markdownToSpeechText(md);
    expect(text).toBe("提示标题\n引用内容 加粗 和 高亮 和 删除 和 code\n列表项\n有序项\n待办");
  });

  it("reads table cells without pipes or separator rows", () => {
    const md = "| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 3 |";
    expect(markdownToSpeechText(md)).toBe("名称，数量\n苹果，3");
  });
});

describe("splitSpeechChunks", () => {
  it("keeps sentences whole and respects a smaller first chunk", () => {
    const sentence = "这是一个十个字的句子。"; // 11 chars
    const text = sentence.repeat(10);
    const chunks = splitSpeechChunks(text, { firstMaxChars: 25, maxChars: 60 });
    expect(chunks.join("")).toBe(text);
    expect(chunks[0].length).toBeLessThanOrEqual(25);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
      expect(chunk.endsWith("。")).toBe(true);
    }
  });

  it("does not merge across paragraphs and skips empty lines", () => {
    expect(splitSpeechChunks("第一段。\n\n\n第二段。", { firstMaxChars: 100, maxChars: 100 }))
      .toEqual(["第一段。", "第二段。"]);
  });

  it("hard-splits an overlong sentence without losing text", () => {
    const long = "字".repeat(130);
    const chunks = splitSpeechChunks(long, { firstMaxChars: 50, maxChars: 50 });
    expect(chunks.join("")).toBe(long);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(50);
  });

  it("returns nothing for whitespace-only input", () => {
    expect(splitSpeechChunks(" \n\n ", { firstMaxChars: 10, maxChars: 10 })).toEqual([]);
  });
});

describe("markdownFromLine", () => {
  const doc = [
    "---",        // 0
    "title: x",   // 1
    "---",        // 2
    "开头段落。", // 3
    "```js",      // 4
    "code();",    // 5
    "```",        // 6
    "代码后的段落。", // 7
    "$$",         // 8
    "x^2",        // 9
    "$$",         // 10
    "结尾。",     // 11
  ].join("\n");

  it("starts at the cursor line", () => {
    expect(markdownFromLine(doc, 7)).toBe(["代码后的段落。", "$$", "x^2", "$$", "结尾。"].join("\n"));
  });

  it("skips past frontmatter when the cursor is inside it", () => {
    expect(markdownToSpeechText(markdownFromLine(doc, 1))).toBe("开头段落。\n\n代码后的段落。\n\n结尾。");
  });

  it("skips past a fenced code block when the cursor is inside it, so the closing fence is not read as an opener", () => {
    expect(markdownFromLine(doc, 5).startsWith("代码后的段落。")).toBe(true);
    expect(markdownToSpeechText(markdownFromLine(doc, 5))).toBe("代码后的段落。\n\n结尾。");
  });

  it("skips past a math block when the cursor is inside it", () => {
    expect(markdownFromLine(doc, 9)).toBe("结尾。");
  });

  it("returns empty text past the end", () => {
    expect(markdownFromLine(doc, 99)).toBe("");
  });
});
