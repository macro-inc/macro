/**
 * Generalized utilities for extracting potential tasks from markdown content.
 * Used by Task Mode in channel input to preview and create tasks from checkboxes.
 */

import {
  extractDateMention,
  extractTitleFromMarkdown,
  extractUserMentions,
} from '@core/component/LexicalMarkdown/plugins/checkbox-to-task/checkboxParsing';

export { extractUserMentions };

/**
 * Represents a potential task extracted from markdown text.
 * Unlike ParsedCheckbox (which requires Lexical node context),
 * this works with raw markdown strings.
 */
type PotentialTask = {
  /** Line index in the source markdown (0-based) */
  lineIndex: number;
  /** Cleaned title without mentions */
  title: string;
  /** Original line for replacement matching */
  rawLine: string;
  /** User IDs extracted from @mentions */
  assigneeUserIds: string[];
  /** ISO date string from date mention, or null */
  dueDate: Date | null;
  /** Whether the checkbox is checked [x] or unchecked [ ] */
  isChecked: boolean;
};

// Pattern to match checkbox lines: "- [ ] text" or "- [x] text"
// Captures: (1) leading whitespace, (2) check state, (3) content after checkbox
const CHECKBOX_LINE_PATTERN = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;

const LEADING_USER_MENTION_PATTERN =
  /^<m-user-mention>[^<]*<\/m-user-mention>\s*/;
const TRAILING_USER_MENTION_PATTERN =
  /\s*<m-user-mention>[^<]*<\/m-user-mention>$/;

/**
 * Trim user @mention tags from the start and end of a markdown string.
 * Mentions in the middle are preserved.
 */
export function trimEdgeUserMentions(markdown: string): string {
  let result = markdown.trim();
  let prev: string;
  do {
    prev = result;
    result = result
      .replace(LEADING_USER_MENTION_PATTERN, '')
      .replace(TRAILING_USER_MENTION_PATTERN, '')
      .trim();
  } while (result !== prev);
  return result;
}

/**
 * Extract all checkbox items from a markdown string as potential tasks.
 *
 * @param markdown - Raw markdown content
 * @returns Array of potential tasks with extracted metadata
 */
export function extractCheckboxesFromMarkdown(
  markdown: string
): PotentialTask[] {
  const lines = markdown.split('\n');
  const tasks: PotentialTask[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = CHECKBOX_LINE_PATTERN.exec(line);

    if (match) {
      const [, leadingWhitespace, checkState, content] = match;
      const isChecked = checkState.toLowerCase() === 'x';

      // Strip leading whitespace before passing to extractTitleFromMarkdown
      // since it expects the line to start with "- [ ]"
      const lineWithoutIndent = line.slice(leadingWhitespace.length);
      const title = extractTitleFromMarkdown(lineWithoutIndent);

      if (!title.trim()) {
        continue;
      }

      tasks.push({
        lineIndex: i,
        title,
        rawLine: line,
        assigneeUserIds: extractUserMentions(content),
        dueDate: extractDateMention(content),
        isChecked,
      });
    }
  }

  return tasks;
}
