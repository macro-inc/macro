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
