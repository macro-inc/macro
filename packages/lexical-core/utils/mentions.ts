import { $dfsIterator } from '@lexical/utils';
import { $getRoot, type LexicalNode } from 'lexical';
import {
  $isContactMentionNode,
  type ContactMentionInfo,
  type ContactMentionNode,
} from '../nodes/ContactMentionNode';
import {
  $isDateMentionNode,
  type DateMentionInfo,
  type DateMentionNode,
} from '../nodes/DateMentionNode';
import {
  $isDocumentMentionNode,
  type DocumentMentionInfo,
  type DocumentMentionNode,
} from '../nodes/DocumentMentionNode';
import {
  $isGroupMentionNode,
  type GroupMentionNode,
} from '../nodes/GroupMentionNode';
import {
  $isPullRequestMentionNode,
  type PullRequestMentionInfo,
  type PullRequestMentionNode,
} from '../nodes/PullRequestMentionNode';
import type { TagMentionInfo } from '../nodes/TagMentionNode';
import {
  $isUserMentionNode,
  type UserMentionInfo,
  type UserMentionNode,
} from '../nodes/UserMentionNode';
import { wrapXml } from '../transformers/transformers';

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
  | DateMentionNode
  | PullRequestMentionNode
  | GroupMentionNode;

export function $isMentionNode(node: LexicalNode): node is MentionNode {
  return (
    $isUserMentionNode(node) ||
    $isDocumentMentionNode(node) ||
    $isContactMentionNode(node) ||
    $isDateMentionNode(node) ||
    $isPullRequestMentionNode(node) ||
    $isGroupMentionNode(node)
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

/** An entity mention in the shape channel messages send to the backend. */
export type ChannelMention = {
  entityType: string;
  entityId: string;
};

/**
 * Entity type for a document-mention block name, mirroring
 * `$mentionItemFromNode` in the web editor's mentions plugin. Plain file
 * block names (md, pdf, csv, ...) and unknown block names are all
 * `document`.
 */
function documentMentionEntityType(blockName: string): string {
  switch (blockName) {
    case 'channel':
      return 'channel';
    case 'project':
      return 'project';
    case 'chat':
      return 'chat';
    case 'email':
      return 'thread';
    case 'call':
      return 'call';
    case 'calendar':
      return 'calendar_event';
    case 'automation':
      return 'automation';
    case 'company':
      return 'crm_company';
    case 'contact':
      return 'crm_contact';
    default:
      return 'document';
  }
}

/**
 * Extracts the mentions in the current editor state as `ChannelMention`s,
 * the way the web editor tracks them while composing a channel message.
 * Document mentions map by block name; user mentions are re-tagged `bot`
 * when they target a bot principal. Contact, date, group, and PR mentions
 * carry no referencable entity and are skipped. Duplicates are dropped.
 */
export function $extractChannelMentions(): ChannelMention[] {
  const out: ChannelMention[] = [];
  const seen = new Set<string>();
  const push = (mention: ChannelMention) => {
    if (!mention.entityId) return;
    const key = `${mention.entityType}:${mention.entityId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(mention);
  };

  for (const node of $extractAllMentions()) {
    if ($isDocumentMentionNode(node)) {
      push({
        entityType: documentMentionEntityType(node.getBlockName()),
        entityId: node.getDocumentId(),
      });
    } else if ($isUserMentionNode(node)) {
      const userId = node.getUserId();
      push({
        entityType: userId.startsWith('bot|') ? 'bot' : 'user',
        entityId: userId,
      });
    }
  }
  return out;
}

export type MentionInfo =
  | (UserMentionInfo & { type: 'user' })
  | (DocumentMentionInfo & { type: 'document' })
  | (PullRequestMentionInfo & { type: 'pr' })
  | (ContactMentionInfo & { type: 'contact' })
  | (DateMentionInfo & { type: 'date' })
  | (TagMentionInfo & { type: 'tag' });

export function buildMentionMarkdownString(info: MentionInfo): string {
  switch (info.type) {
    case 'user':
      return wrapXml('m-user-mention', dropKey(info, 'type'));
    case 'document':
      return wrapXml('m-document-mention', dropKey(info, 'type'));
    case 'pr':
      return wrapXml('m-pr-mention', dropKey(info, 'type'));
    case 'contact':
      return wrapXml('m-contact-mention', dropKey(info, 'type'));
    case 'date':
      return wrapXml('m-date-mention', dropKey(info, 'type'));
    case 'tag':
      return wrapXml('m-tag', dropKey(info, 'type'));
  }
}

export {
  markdownToEmbeddingText,
  markdownToPlainText,
  parseContactMentions,
  parseDateMentions,
  parseDocumentMentions,
  parseGroupMentions,
  parseLinks,
  parsePullRequestMentions,
  parseReplyTargets,
  parseTagMentions,
  parseUserMentions,
} from './parsers';
