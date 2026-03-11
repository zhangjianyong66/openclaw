/**
 * Feishu message splitter with intelligent markdown-aware chunking.
 *
 * Splitting strategy (in order of preference):
 * 1. Level 1: Split by headings (# ## ###)
 * 2. Level 2: Split by paragraphs (blank lines)
 * 3. Level 3: Split by lines
 * 4. Smart merge: Combine small sections that fit within limit
 */

/** Feishu's actual limit is 2000, we use 1900 for safety margin */
export const FEISHU_TEXT_LIMIT = 1900;

/** Regex to match markdown headings (lines starting with 1-6 # characters) */
const HEADING_RE = /^(#{1,6})\s+.+$/;

/**
 * Represents a fenced code block span.
 */
type FenceSpan = {
  start: number;
  end: number;
};

/**
 * Parse fenced code blocks (``` or ~~~) in the text.
 * Returns array of spans indicating code block ranges.
 */
function parseFenceSpans(buffer: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let open:
    | {
        start: number;
        markerChar: string;
        markerLen: number;
      }
    | undefined;

  let offset = 0;
  while (offset <= buffer.length) {
    const nextNewline = buffer.indexOf("\n", offset);
    const lineEnd = nextNewline === -1 ? buffer.length : nextNewline;
    const line = buffer.slice(offset, lineEnd);

    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (match) {
      const marker = match[2];
      const markerChar = marker[0]!;
      const markerLen = marker.length;
      if (!open) {
        open = {
          start: offset,
          markerChar,
          markerLen,
        };
      } else if (open.markerChar === markerChar && markerLen >= open.markerLen) {
        spans.push({
          start: open.start,
          end: lineEnd,
        });
        open = undefined;
      }
    }

    if (nextNewline === -1) {
      break;
    }
    offset = nextNewline + 1;
  }

  // Handle unclosed fence
  if (open) {
    spans.push({
      start: open.start,
      end: buffer.length,
    });
  }

  return spans;
}

/**
 * Check if an index is inside a fenced code block.
 */
function isInFence(spans: FenceSpan[], index: number): boolean {
  for (const span of spans) {
    if (index > span.start && index < span.end) {
      return true;
    }
    if (index >= span.end) {
      break;
    }
  }
  return false;
}

/**
 * Check if it's safe to break at the given index (not inside a fence).
 */
function isSafeBreak(spans: FenceSpan[], index: number): boolean {
  return !isInFence(spans, index);
}

/**
 * Represents a section of text with metadata about its boundaries.
 */
type Section = {
  text: string;
  isHeading: boolean;
  headingLevel: number;
};

/**
 * Split text into sections by headings, respecting fenced code blocks.
 */
function splitByHeadings(text: string): Section[] {
  const spans = parseFenceSpans(text);
  const lines = text.split("\n");
  const sections: Section[] = [];

  let currentSection: string[] = [];
  let currentIsHeading = false;
  let currentHeadingLevel = 0;
  let offset = 0;

  const flushSection = () => {
    if (currentSection.length > 0) {
      const sectionText = currentSection.join("\n").trim();
      if (sectionText) {
        sections.push({
          text: sectionText,
          isHeading: currentIsHeading,
          headingLevel: currentHeadingLevel,
        });
      }
      currentSection = [];
      currentIsHeading = false;
      currentHeadingLevel = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const lineStart = offset;

    // Check if this line is inside a fence
    const inFence = isInFence(spans, lineStart);

    // Check for heading (only outside fences)
    const headingMatch = !inFence && HEADING_RE.test(line);

    if (headingMatch && !currentIsHeading && currentSection.length > 0) {
      // Found a heading and we have content - flush current section
      flushSection();
    }

    if (headingMatch) {
      const match = line.match(HEADING_RE);
      currentIsHeading = true;
      currentHeadingLevel = match?.[1]?.length ?? 0;
    } else {
      currentIsHeading = false;
    }

    currentSection.push(line);
    offset += line.length + 1; // +1 for the newline
  }

  // Flush remaining content
  flushSection();

  return sections;
}

/**
 * Split a section into paragraphs (blank line boundaries).
 * Respects fenced code blocks.
 */
function splitByParagraphs(text: string): string[] {
  const spans = parseFenceSpans(text);

  // Normalize to \n so blank line detection is consistent
  const normalized = text.replace(/\r\n?/g, "\n");

  // Fast-path: no blank lines
  const paragraphRe = /\n[\t ]*\n+/;
  if (!paragraphRe.test(normalized)) {
    return normalized.trim() ? [normalized.trim()] : [];
  }

  const parts: string[] = [];
  const re = /\n[\t ]*\n+/g;
  let lastIndex = 0;

  for (const match of normalized.matchAll(re)) {
    const idx = match.index ?? 0;

    // Do not split on blank lines inside fenced code blocks
    if (!isSafeBreak(spans, idx)) {
      continue;
    }

    parts.push(normalized.slice(lastIndex, idx));
    lastIndex = idx + match[0].length;
  }
  parts.push(normalized.slice(lastIndex));

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Split text by lines, respecting fenced code blocks.
 */
function splitByLines(text: string, limit: number): string[] {
  const spans = parseFenceSpans(text);
  const lines = text.split("\n");
  const chunks: string[] = [];

  let currentChunk: string[] = [];
  let currentLength = 0;
  let offset = 0;

  const flushChunk = () => {
    if (currentChunk.length > 0) {
      const chunk = currentChunk.join("\n").trim();
      if (chunk) {
        chunks.push(chunk);
      }
      currentChunk = [];
      currentLength = 0;
    }
  };

  for (const line of lines) {
    const lineLength = line.length + (currentChunk.length > 0 ? 1 : 0); // +1 for newline

    // Check if adding this line would exceed limit
    if (currentLength + lineLength > limit && currentChunk.length > 0) {
      // Check if we can break at this point (not inside fence)
      const breakOffset = offset;
      if (isSafeBreak(spans, breakOffset)) {
        flushChunk();
      }
    }

    currentChunk.push(line);
    currentLength += lineLength;
    offset += line.length + 1; // +1 for newline
  }

  // Flush remaining
  if (currentChunk.length > 0) {
    const chunk = currentChunk.join("\n").trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Merge small sections intelligently.
 * Adjacent sections are merged if their combined length doesn't exceed the limit.
 */
function mergeSections(sections: Section[], limit: number): string[] {
  if (sections.length === 0) {
    return [];
  }

  const merged: string[] = [];
  let currentBatch: string[] = [];
  let currentLength = 0;

  for (const section of sections) {
    const sectionText = section.text;
    const sectionLength = sectionText.length;

    // If section alone exceeds limit, we need to split it further
    if (sectionLength > limit) {
      // First flush current batch
      if (currentBatch.length > 0) {
        merged.push(currentBatch.join("\n\n"));
        currentBatch = [];
        currentLength = 0;
      }

      // Split the oversized section by paragraphs
      const paragraphs = splitByParagraphs(sectionText);

      // Try to merge paragraphs
      const paragraphChunks = mergeParagraphs(paragraphs, limit);

      // If still too long, split by lines
      for (const chunk of paragraphChunks) {
        if (chunk.length <= limit) {
          merged.push(chunk);
        } else {
          // Final fallback: split by lines
          const lineChunks = splitByLines(chunk, limit);
          merged.push(...lineChunks);
        }
      }
      continue;
    }

    // Check if we can add this section to current batch
    const separator = currentBatch.length > 0 ? "\n\n" : "";
    const newLength = currentLength + separator.length + sectionLength;

    if (newLength <= limit) {
      currentBatch.push(sectionText);
      currentLength = newLength;
    } else {
      // Flush current batch and start new one
      if (currentBatch.length > 0) {
        merged.push(currentBatch.join("\n\n"));
      }
      currentBatch = [sectionText];
      currentLength = sectionLength;
    }
  }

  // Flush remaining batch
  if (currentBatch.length > 0) {
    merged.push(currentBatch.join("\n\n"));
  }

  return merged;
}

/**
 * Merge paragraphs intelligently within limit.
 */
function mergeParagraphs(paragraphs: string[], limit: number): string[] {
  if (paragraphs.length === 0) {
    return [];
  }

  const merged: string[] = [];
  let currentBatch: string[] = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = paragraph.length;

    // If paragraph alone exceeds limit, it will be handled later
    if (paragraphLength > limit) {
      // Flush current batch first
      if (currentBatch.length > 0) {
        merged.push(currentBatch.join("\n\n"));
        currentBatch = [];
        currentLength = 0;
      }
      merged.push(paragraph);
      continue;
    }

    // Check if we can add this paragraph
    const separator = currentBatch.length > 0 ? "\n\n" : "";
    const newLength = currentLength + separator.length + paragraphLength;

    if (newLength <= limit) {
      currentBatch.push(paragraph);
      currentLength = newLength;
    } else {
      // Flush and start new batch
      if (currentBatch.length > 0) {
        merged.push(currentBatch.join("\n\n"));
      }
      currentBatch = [paragraph];
      currentLength = paragraphLength;
    }
  }

  // Flush remaining
  if (currentBatch.length > 0) {
    merged.push(currentBatch.join("\n\n"));
  }

  return merged;
}

/**
 * Split markdown text for Feishu with intelligent chunking.
 *
 * Strategy:
 * 1. Split by headings first
 * 2. Then split by paragraphs
 * 3. Finally split by lines if needed
 * 4. Merge small sections that fit within limit
 */
export function splitFeishuMessage(text: string, limit: number = FEISHU_TEXT_LIMIT): string[] {
  if (!text) {
    return [];
  }

  // Trim the text first
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // Fast-path: text fits in one chunk
  if (trimmed.length <= limit) {
    return [trimmed];
  }

  // Step 1: Split by headings
  const sections = splitByHeadings(trimmed);

  // Step 2: Merge sections intelligently (also handles paragraph/line splitting internally)
  return mergeSections(sections, limit);
}
