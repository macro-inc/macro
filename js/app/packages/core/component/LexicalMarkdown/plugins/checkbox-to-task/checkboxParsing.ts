import type { ListItemNode } from '@lexical/list';
import { $isDateMentionNode, $isUserMentionNode } from '@lexical-core';
import {
  parseContactMentions,
  parseDocumentMentions,
  parseGroupMentions,
} from '@lexical-core/utils/parsers';
import { isValid } from 'date-fns';
import { $isElementNode, type LexicalNode } from 'lexical';
import { $elementNodeToMarkdown } from '../../utils';
import type { ParsedCheckbox } from './types';

// Patterns for extracting data from mentions (not for replacement)
const USER_MENTION_PATTERN = /<m-user-mention>(.*?)<\/m-user-mention>/;
const DATE_MENTION_PATTERN = /<m-date-mention>(.*?)<\/m-date-mention>/;

/**
 * Extract user IDs from user mention XML tags in markdown text
 */
export function extractUserMentions(markdownText: string): string[] {
  const userIds: string[] = [];
  const matches = markdownText.matchAll(new RegExp(USER_MENTION_PATTERN, 'g'));

  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      if (data.userId) {
        userIds.push(data.userId);
      }
    } catch {
      // Invalid JSON, skip this mention
    }
  }

  return userIds;
}

/**
 * Extract the first date mention from markdown text.
 * Returns parsed ISO date string Date object or null.
 */
export function extractDateMention(markdownText: string): Date | null {
  const match = DATE_MENTION_PATTERN.exec(markdownText);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    const maybeIsoString = data.date;
    if (!maybeIsoString) return null;
    const date = new Date(maybeIsoString);
    if (!isValid(date)) return null;
    return date;
  } catch {
    return null;
  }
}

/**
 * Convert markdown text to plain text title.
 * Removes user/date mentions (they become task properties) and converts
 * other mentions to readable text using existing parsers.
 */
export function extractTitleFromMarkdown(markdownText: string): string {
  let title = markdownText;

  title = title.replace(new RegExp(USER_MENTION_PATTERN, 'g'), '');
  title = title.replace(new RegExp(DATE_MENTION_PATTERN, 'g'), '');

  title = parseDocumentMentions(title);
  title = parseContactMentions(title);
  title = parseGroupMentions(title);

  // Remove checkbox prefix if present (e.g., "- [ ] " or "- [x] ")
  title = title.replace(/^-\s*\[[ x]\]\s*/i, '');

  return title.trim().replace(/\s+/g, ' ');
}

/**
 * Get plain text title from a ListItemNode, collecting text from all children
 * except user/date mentions (which become task properties instead).
 */
function $extractTitleFromNode(node: ListItemNode): string {
  return $collectTextContent(node).trim().replace(/\s+/g, ' ');
}

function $collectTextContent(node: LexicalNode): string {
  if ($isUserMentionNode(node) || $isDateMentionNode(node)) {
    return '';
  }
  if ($isElementNode(node)) {
    return node
      .getChildren()
      .map((child) => $collectTextContent(child))
      .join('');
  }
  return node.getTextContent();
}

/**
 * Parse a ListItemNode checkbox into structured data for task creation.
 * Must be called within Lexical update context (not read) because
 * $elementNodeToMarkdown requires update context.
 */
export function $parseCheckboxNode(node: ListItemNode): ParsedCheckbox {
  const rawMarkdown = $elementNodeToMarkdown(node, 'internal');

  return {
    nodeKey: node.getKey(),
    title: $extractTitleFromNode(node),
    rawMarkdown,
    assigneeUserIds: extractUserMentions(rawMarkdown),
    dueDate: extractDateMention(rawMarkdown),
  };
}

/**
 * Parse multiple checkbox nodes
 */
export function $parseCheckboxNodes(nodes: ListItemNode[]): ParsedCheckbox[] {
  return nodes.map($parseCheckboxNode);
}
