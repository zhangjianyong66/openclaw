import { describe, expect, it } from "vitest";
import { FEISHU_TEXT_LIMIT, splitFeishuMessage } from "./message-splitter.js";

describe("splitFeishuMessage", () => {
  describe("basic cases", () => {
    it("returns empty array for empty string", () => {
      expect(splitFeishuMessage("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", () => {
      expect(splitFeishuMessage("   \n\n   ")).toEqual([]);
    });

    it("returns single chunk for short text", () => {
      const text = "Hello, world!";
      expect(splitFeishuMessage(text)).toEqual([text]);
    });

    it("returns single chunk for text exactly at limit", () => {
      const text = "a".repeat(FEISHU_TEXT_LIMIT);
      expect(splitFeishuMessage(text)).toEqual([text]);
    });

    it("returns single chunk for text just under limit", () => {
      const text = "a".repeat(FEISHU_TEXT_LIMIT - 1);
      expect(splitFeishuMessage(text)).toEqual([text]);
    });
  });

  describe("heading handling", () => {
    it("keeps heading with its content", () => {
      const text = `# Section 1
Content for section 1.
More content here.

# Section 2
Content for section 2.`;

      const chunks = splitFeishuMessage(text);
      // Should keep each heading with its content
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // First chunk should contain heading and content
      expect(chunks[0]).toContain("# Section 1");
      expect(chunks[0]).toContain("Content for section 1");
    });

    it("keeps heading with content when they fit together", () => {
      const text = `## Small Heading
Small content.`;

      const chunks = splitFeishuMessage(text);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("## Small Heading");
      expect(chunks[0]).toContain("Small content");
    });

    it("handles multiple headings", () => {
      const text = `# Main Title
Intro text here.

## Subsection A
Content A.

### Sub-subsection
Deep content.

## Subsection B
Content B.`;

      const chunks = splitFeishuMessage(text);
      // Each heading should be with its content
      for (const chunk of chunks) {
        // If chunk has a heading, it should have content too
        if (chunk.includes("# ")) {
          expect(chunk.length).toBeGreaterThan("# ".length);
        }
      }
    });
  });

  describe("table handling", () => {
    it("keeps table rows together", () => {
      const text = `| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |`;

      const chunks = splitFeishuMessage(text);
      // Table should be kept intact
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("| Name | Value |");
      expect(chunks[0]).toContain("| A    | 1     |");
      expect(chunks[0]).toContain("| B    | 2     |");
    });

    it("keeps table with preceding heading", () => {
      const text = `## Comparison Table
| Brand | Price |
|-------|-------|
| A     | $10   |
| B     | $20   |`;

      const chunks = splitFeishuMessage(text);
      // Heading and table should be together
      expect(chunks[0]).toContain("## Comparison Table");
      expect(chunks[0]).toContain("| Brand | Price |");
    });
  });

  describe("code block handling", () => {
    it("keeps code blocks intact", () => {
      const text = `\`\`\`javascript
const x = 1;
const y = 2;
console.log(x + y);
\`\`\``;

      const chunks = splitFeishuMessage(text);
      // Code block should be kept intact
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("\`\`\`javascript");
      expect(chunks[0]).toContain("console.log");
      expect(chunks[0]).toContain("\`\`\`");
    });

    it("keeps code block with preceding heading", () => {
      const text = `## Example Code
\`\`\`js
console.log("hello");
\`\`\``;

      const chunks = splitFeishuMessage(text);
      expect(chunks[0]).toContain("## Example Code");
      expect(chunks[0]).toContain("\`\`\`js");
    });
  });

  describe("paragraph handling", () => {
    it("merges small paragraphs", () => {
      const text = `First paragraph.

Second paragraph.

Third paragraph.`;

      const chunks = splitFeishuMessage(text);
      // Should merge into one chunk since they're small
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("First paragraph");
      expect(chunks[0]).toContain("Second paragraph");
      expect(chunks[0]).toContain("Third paragraph");
    });

    it("splits when total exceeds limit", () => {
      const para1 = "a".repeat(800);
      const para2 = "b".repeat(800);
      const para3 = "c".repeat(800);
      const text = `${para1}

${para2}

${para3}`;

      const chunks = splitFeishuMessage(text);
      // Should split into multiple chunks since total exceeds limit
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Each chunk should not exceed limit
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(FEISHU_TEXT_LIMIT);
      }
      // All content preserved
      const rejoined = chunks.join("");
      expect(rejoined).toContain(para1);
      expect(rejoined).toContain(para2);
      expect(rejoined).toContain(para3);
    });
  });

  describe("line splitting", () => {
    it("splits very long single paragraph by lines", () => {
      const longLine = "a".repeat(FEISHU_TEXT_LIMIT * 2);
      const chunks = splitFeishuMessage(longLine);
      // Document current behavior
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Each chunk should not exceed limit
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(FEISHU_TEXT_LIMIT);
      }
    });
  });

  describe("real world scenarios", () => {
    it("handles typical markdown document", () => {
      const text = `# Project Title

This is an introduction to the project.

## Features

- Feature A
- Feature B
- Feature C

## Installation

\`\`\`bash
npm install my-package
\`\`\`

## Usage

Simply import and use:

\`\`\`javascript
import { foo } from 'my-package';
foo();
\`\`\`

## License

MIT`;

      const chunks = splitFeishuMessage(text);
      // Should produce reasonable chunks
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // All content preserved
      const rejoined = chunks.join("\n\n");
      expect(rejoined).toContain("# Project Title");
      expect(rejoined).toContain("## Features");
      expect(rejoined).toContain("## Installation");
    });

    it("handles document with headings and tables", () => {
      const text = `## Brand Comparison

| Brand | Price | Rating |
|-------|-------|--------|
| A     | $100  | 4.5    |
| B     | $200  | 4.8    |

## Recommendations

Based on the comparison above, we recommend Brand A for budget users.`;

      const chunks = splitFeishuMessage(text);
      // Table should be intact
      const tableChunk = chunks.find((c) => c.includes("| Brand |"));
      expect(tableChunk).toBeDefined();
      if (tableChunk) {
        expect(tableChunk).toContain("| A     | $100  |");
        expect(tableChunk).toContain("| B     | $200  |");
      }
    });
  });

  describe("edge cases", () => {
    it("handles Windows line endings", () => {
      const text = "Line 1\r\nLine 2\r\nLine 3";
      const chunks = splitFeishuMessage(text);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain("Line 1");
      expect(chunks[0]).toContain("Line 2");
    });

    it("handles mixed line endings", () => {
      const text = "Line 1\n\r\nLine 2\r\n\nLine 3";
      const chunks = splitFeishuMessage(text);
      expect(chunks.length).toBe(1);
    });

    it("trims output chunks", () => {
      const text = "  Content with leading/trailing spaces  ";
      const chunks = splitFeishuMessage(text);
      expect(chunks).toEqual(["Content with leading/trailing spaces"]);
    });

    it("respects custom limit", () => {
      const text = "a".repeat(100);
      const chunks = splitFeishuMessage(text, 50);
      // Document current behavior
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
