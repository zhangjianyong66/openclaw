/**
 * Feishu message splitter with intelligent markdown-aware chunking.
 *
 * Splitting strategy:
 * 1. Keep content integrity: headings with their content, tables intact
 * 2. Split by paragraphs first
 * 3. Merge small paragraphs that fit within limit
 * 4. Split by lines only when single paragraph exceeds limit
 */

/**
 * Feishu's actual limit is 2000 characters.
 * We use 1900 for safety margin.
 */
export const FEISHU_TEXT_LIMIT = 1900;

/**
 * Check if a line is a markdown heading.
 */
function isHeading(line: string): boolean {
  return /^#{1,6}\s+.+$/.test(line);
}

/**
 * Check if a line is a table row (contains |).
 */
function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().startsWith("|");
}

/**
 * Check if a line is a table separator (contains only -, |, :, and spaces).
 */
function isTableSeparator(line: string): boolean {
  return /^\s*\|[-:|\s]+\|\s*$/.test(line);
}

/**
 * Check if a line starts or ends a fenced code block.
 */
function isFence(line: string): boolean {
  return /^(```|~~~)/.test(line.trim());
}

/**
 * Split text into logical blocks (paragraphs, tables, code blocks, etc.).
 * Each block should be kept intact if possible.
 */
function splitIntoBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inCodeBlock = false;
  let inTable = false;

  const flushBlock = () => {
    if (currentBlock.length > 0) {
      const block = currentBlock.join("\n").trim();
      if (block) {
        blocks.push(block);
      }
      currentBlock = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (isFence(line)) {
      if (inCodeBlock) {
        // End of code block
        currentBlock.push(line);
        flushBlock();
        inCodeBlock = false;
        continue;
      } else {
        // Start of code block
        flushBlock();
        inCodeBlock = true;
        currentBlock.push(line);
        continue;
      }
    }

    if (inCodeBlock) {
      currentBlock.push(line);
      continue;
    }

    // Handle headings - start new block
    if (isHeading(line)) {
      flushBlock();
      currentBlock.push(line);
      continue;
    }

    // Handle tables
    if (isTableRow(line) || isTableSeparator(line)) {
      if (!inTable) {
        flushBlock();
        inTable = true;
      }
      currentBlock.push(line);
      continue;
    } else if (inTable && line.trim() === "") {
      // Empty line ends table
      flushBlock();
      inTable = false;
      continue;
    } else if (inTable) {
      // Non-table line ends table
      flushBlock();
      inTable = false;
      // Fall through to handle this line
    }

    // Handle empty lines (paragraph separators)
    if (line.trim() === "") {
      flushBlock();
      continue;
    }

    // Regular line
    currentBlock.push(line);
  }

  // Flush remaining
  flushBlock();

  return blocks;
}

/**
 * Merge blocks intelligently.
 * Key rule: Keep heading with its following content.
 */
function mergeBlocks(blocks: string[], limit: number): string[] {
  if (blocks.length === 0) {
    return [];
  }

  const merged: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  let pendingHeading: string | null = null;

  const flushChunk = () => {
    if (currentChunk.length > 0) {
      merged.push(currentChunk.join("\n\n"));
      currentChunk = [];
      currentLength = 0;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockLength = block.length;

    // If block alone exceeds limit, we need to split it
    if (blockLength > limit) {
      // First flush any pending content
      flushChunk();

      // Split oversized block by lines
      const lines = block.split("\n");
      let lineChunk: string[] = [];
      let lineChunkLength = 0;

      for (const line of lines) {
        // If single line exceeds limit, we have to split it (rare case)
        if (line.length > limit) {
          // Flush current line chunk first
          if (lineChunk.length > 0) {
            merged.push(lineChunk.join("\n"));
            lineChunk = [];
            lineChunkLength = 0;
          }
          // Split long line by character limit
          for (let i = 0; i < line.length; i += limit) {
            merged.push(line.slice(i, i + limit));
          }
          continue;
        }

        const lineLen = line.length + (lineChunk.length > 0 ? 1 : 0);

        if (lineChunkLength + lineLen > limit && lineChunk.length > 0) {
          merged.push(lineChunk.join("\n"));
          lineChunk = [line];
          lineChunkLength = line.length;
        } else {
          lineChunk.push(line);
          lineChunkLength += lineLen;
        }
      }

      if (lineChunk.length > 0) {
        merged.push(lineChunk.join("\n"));
      }
      continue;
    }

    // Check if this is a heading
    const isBlockHeading = isHeading(block.split("\n")[0] || "");

    if (isBlockHeading) {
      // If we have a previous heading waiting for content, flush it
      if (pendingHeading !== null) {
        // Previous heading has no content, just add it
        currentChunk.push(pendingHeading);
        currentLength += pendingHeading.length + (currentLength > 0 ? 2 : 0);
      }
      // Set this as pending - wait for next block
      pendingHeading = block;
      continue;
    }

    // If we have a pending heading, try to merge it with this block
    if (pendingHeading !== null) {
      const combinedLength = pendingHeading.length + block.length + 2; // +2 for \n\n

      if (combinedLength <= limit) {
        // Can fit together
        currentChunk.push(pendingHeading);
        currentChunk.push(block);
        currentLength += combinedLength + (currentLength > 0 ? 2 : 0);
        pendingHeading = null;
        continue;
      } else {
        // Can't fit, flush heading alone
        if (currentLength > 0) {
          flushChunk();
        }
        merged.push(pendingHeading);
        // Now try to add this block
        pendingHeading = null;
        // Fall through to add block normally
      }
    }

    // Check if we can add this block to current chunk
    const separator = currentChunk.length > 0 ? 2 : 0; // \n\n
    const newLength = currentLength + separator + blockLength;

    if (newLength <= limit) {
      currentChunk.push(block);
      currentLength = newLength;
    } else {
      // Flush and start new chunk
      flushChunk();
      currentChunk.push(block);
      currentLength = blockLength;
    }
  }

  // Handle any remaining pending heading
  if (pendingHeading !== null) {
    if (currentLength + pendingHeading.length + 2 <= limit) {
      currentChunk.push(pendingHeading);
    } else {
      flushChunk();
      merged.push(pendingHeading);
    }
  }

  // Flush final chunk
  flushChunk();

  return merged;
}

/**
 * Split markdown text for Feishu with intelligent chunking.
 *
 * Strategy:
 * 1. Split into logical blocks (headings, paragraphs, tables, code blocks)
 * 2. Merge blocks intelligently, keeping headings with their content
 * 3. Split by lines only when single block exceeds limit
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

  // Step 1: Split into logical blocks
  const blocks = splitIntoBlocks(trimmed);

  // Step 2: Merge blocks intelligently
  return mergeBlocks(blocks, limit);
}
