import type { ListItemNode } from '@lexical/list';
import { $elementNodeToMarkdown } from '../../utils';
import type { ParsedCheckbox } from './types';

// Regex patterns for mention extraction (matching existing transformers in mentions.ts)
const USER_MENTION_REGEX = /<m-user-mention>(.*?)<\/m-user-mention>/g;
const DATE_MENTION_REGEX = /<m-date-mention>(.*?)<\/m-date-mention>/g;
const DOCUMENT_MENTION_REGEX =
  /<m-document-mention>(.*?)<\/m-document-mention>/g;
const CONTACT_MENTION_REGEX = /<m-contact-mention>(.*?)<\/m-contact-mention>/g;
const GROUP_MENTION_REGEX = /<m-group-mention>(.*?)<\/m-group-mention>/g;

/**
 * Extract user IDs from user mention XML tags in markdown text
 */
export function extractUserMentions(markdownText: string): string[] {
  const userIds: string[] = [];
  const regex = new RegExp(USER_MENTION_REGEX.source, 'g');
  const matches = markdownText.matchAll(regex);

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
 * Returns ISO date string or null.
 */
export function extractDateMention(markdownText: string): string | null {
  const regex = new RegExp(DATE_MENTION_REGEX.source);
  const match = regex.exec(markdownText);

  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return data.date ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert markdown text to plain text title.
 * Removes user/date mentions (they become task properties) and converts
 * other mentions to readable text.
 */
export function extractTitleFromMarkdown(markdownText: string): string {
  let title = markdownText;

  // Remove user mentions entirely (they become assignees)
  title = title.replace(new RegExp(USER_MENTION_REGEX.source, 'g'), '');

  // Remove date mentions entirely (they become due date)
  title = title.replace(new RegExp(DATE_MENTION_REGEX.source, 'g'), '');

  // Replace document mentions with document name
  title = title.replace(
    new RegExp(DOCUMENT_MENTION_REGEX.source, 'g'),
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.documentName || '';
      } catch {
        return '';
      }
    }
  );

  // Replace contact mentions with name
  title = title.replace(
    new RegExp(CONTACT_MENTION_REGEX.source, 'g'),
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.name || data.emailOrDomain || '';
      } catch {
        return '';
      }
    }
  );

  // Replace group mentions with @alias
  title = title.replace(
    new RegExp(GROUP_MENTION_REGEX.source, 'g'),
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return `@${data.groupAlias || ''}`;
      } catch {
        return '';
      }
    }
  );

  // Remove checkbox prefix if present (e.g., "- [ ] " or "- [x] ")
  title = title.replace(/^-\s*\[[ x]\]\s*/i, '');

  // Clean up extra whitespace
  return title.trim().replace(/\s+/g, ' ');
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
    node,
    title: extractTitleFromMarkdown(rawMarkdown),
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
