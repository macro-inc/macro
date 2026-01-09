/**
 * Utilities for extracting information from search highlight content
 * that contains <macro_em> tags marking matched terms.
 */

/**
 * Extracts terms from macro_em tags in the highlighted content.
 * Returns array of text strings that should be highlighted, preserving order and duplicates.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Array of matched terms
 *
 * @example
 * extractSearchTerms("The <macro_em>quick</macro_em> brown <macro_em>fox</macro_em>")
 * // Returns: ["quick", "fox"]
 */
export function extractSearchTerms(highlightedContent: string): string[] {
  const terms: string[] = [];
  const macroEmRegex = /<macro_em>(.*?)<\/macro_em>/gs;
  const matches = Array.from(highlightedContent.matchAll(macroEmRegex));

  for (const match of matches) {
    terms.push(match[1].trim());
  }

  return terms;
}

/**
 * Extracts the full snippet from highlighted content by removing macro_em tags.
 * Whitespace is normalized and trimmed.
 * This provides context for the search result.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Clean text snippet with normalized whitespace
 *
 * @example
 * extractSearchSnippet("The <macro_em>quick</macro_em>\n  brown   fox")
 * // Returns: "The quick brown fox"
 */
export function extractSearchSnippet(highlightedContent: string): string {
  const rawContent = highlightedContent.replace(/<\/?macro_em>/g, '');
  return rawContent.replace(/\s+/g, ' ').trim();
}

/**
 * Merges adjacent macro_em tags in highlighted content.
 * When multiple macro_em tags appear consecutively (with only whitespace between them),
 * they are merged into a single macro_em tag.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Content with adjacent macro_em tags merged
 *
 * @example
 * mergeAdjacentMacroEmTags("The <macro_em>quick</macro_em> <macro_em>brown</macro_em> fox")
 * // Returns: "The <macro_em>quick brown</macro_em> fox"
 *
 * @example
 * mergeAdjacentMacroEmTags("<macro_em>Hello</macro_em> <macro_em>world</macro_em>, <macro_em>goodbye</macro_em>")
 * // Returns: "<macro_em>Hello world</macro_em>, <macro_em>goodbye</macro_em>"
 */
export function mergeAdjacentMacroEmTags(highlightedContent: string): string {
  return highlightedContent.replace(/<\/macro_em>(\s+)<macro_em>/g, '$1');
}

/**
 * Truncate markdown returned from the search service so that the *first*
 * <macro_em> match is visible within a fixed character window.
 *
 * Behavior:
 * - Only the first line containing a <macro_em> tag is considered.
 * - Other <macro_em> tags on the same line are preserved verbatim.
 * - If the match line is not the first line, the result is prefixed with "...".
 * - If the opening <macro_em> tag starts beyond the allowed window,
 *   content is trimmed from the front (preferably at a word boundary)
 *   until the tag is within the window.
 * - When front-trimming occurs, "..." is prepended.
 *
 * @param text - Markdown source content from search results.
 * @param chars - Maximum visible character window (excluding ellipsis).
 * @returns A truncated string that guarantees visibility of the first match.
 */
export function truncateSearchMatch(text: string, chars: number): string {
  const lines = text.split('\n');
  const macroOpen = '<macro_em>';

  const lineIndex = lines.findIndex((l) => l.includes(macroOpen));
  if (lineIndex === -1) {
    return text;
  }

  let line = lines[lineIndex];
  let needsEllipsis = lineIndex > 0;

  const tagIndex = line.indexOf(macroOpen);

  if (tagIndex <= chars) {
    return (needsEllipsis ? '...' : '') + line;
  }

  const targetStart = Math.max(0, tagIndex - chars);

  // prefer trimming at a word boundary
  let cutIndex = targetStart;
  for (let i = targetStart; i < tagIndex; i++) {
    if (/\s/.test(line[i])) {
      cutIndex = i + 1;
      break;
    }
  }

  line = line.slice(cutIndex);
  return '...' + line;
}
