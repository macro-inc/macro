import { $dfsIterator } from '@lexical/utils';
import {
  $isContactMentionNode,
  type ContactMentionInfo,
  type ContactMentionNode,
} from '@lexical-core/nodes/ContactMentionNode';
import {
  $isDateMentionNode,
  type DateMentionInfo,
  type DateMentionNode,
} from '@lexical-core/nodes/DateMentionNode';
import {
  $isDocumentMentionNode,
  type DocumentMentionInfo,
  type DocumentMentionNode,
} from '@lexical-core/nodes/DocumentMentionNode';
import {
  $isUserMentionNode,
  type UserMentionInfo,
  type UserMentionNode,
} from '@lexical-core/nodes/UserMentionNode';
import { wrapXml } from '@lexical-core/transformers/transformers';
import { $getRoot, type LexicalNode } from 'lexical';

function dropKey<T extends object, K extends keyof T>(
  obj: T,
  key: K
): Omit<T, K> {
  const { [key]: _, ...rest } = obj;
  return rest;
}

export type MentionNode =
  | UserMentionNode
  | DocumentMentionNode
  | ContactMentionNode
  | DateMentionNode;

export function $isMentionNode(node: LexicalNode): node is MentionNode {
  return (
    $isUserMentionNode(node) ||
    $isDocumentMentionNode(node) ||
    $isContactMentionNode(node) ||
    $isDateMentionNode(node)
  );
}

export function $extractAllMentions(): MentionNode[] {
  const iterator = $dfsIterator($getRoot());
  const out: MentionNode[] = [];
  for (const { node } of iterator) {
    if ($isMentionNode(node)) {
      out.push(node);
    }
  }
  return out;
}

export type MentionInfo =
  | (UserMentionInfo & { type: 'user' })
  | (DocumentMentionInfo & { type: 'document' })
  | (ContactMentionInfo & { type: 'contact' })
  | (DateMentionInfo & { type: 'date' });

export function buildMentionMarkdownString(info: MentionInfo): string {
  switch (info.type) {
    case 'user':
      return wrapXml('m-user-mention', dropKey(info, 'type'));
    case 'document':
      return wrapXml('m-document-mention', dropKey(info, 'type'));
    case 'contact':
      return wrapXml('m-contact-mention', dropKey(info, 'type'));
    case 'date':
      return wrapXml('m-date-mention', dropKey(info, 'type'));
  }
}

/**
 * Converts markdown text with XML mention tags to plain text.
 * Extracts the readable text from mention nodes:
 * - User mentions: email
 * - Contact mentions: name (fallback to emailOrDomain)
 * - Date mentions: displayFormat
 * - Document mentions: documentName
 */
export function markdownToPlainText(markdown: string): string {
  let result = markdown;

  // Replace user mentions with email
  result = result.replace(
    /<m-user-mention>(.*?)<\/m-user-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.email || '';
      } catch {
        return '';
      }
    }
  );

  // Replace contact mentions with name or emailOrDomain
  result = result.replace(
    /<m-contact-mention>(.*?)<\/m-contact-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.name || data.emailOrDomain || '';
      } catch {
        return '';
      }
    }
  );

  // Replace date mentions with displayFormat
  result = result.replace(
    /<m-date-mention>(.*?)<\/m-date-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.displayFormat || '';
      } catch {
        return '';
      }
    }
  );

  // Replace document mentions with documentName
  result = result.replace(
    /<m-document-mention>(.*?)<\/m-document-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.documentName || '';
      } catch {
        return '';
      }
    }
  );

  return result;
}
