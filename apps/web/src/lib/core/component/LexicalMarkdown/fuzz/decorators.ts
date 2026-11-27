/**
 * One node of every decorator type the collaborative markdown editor renders,
 * with placeholder data, so a fuzz run can mount them all on every peer. A
 * decorator type added to `SupportedNodeTypes` and the decorator registry
 * without a factory here fails `missingDecoratorTypes`.
 */

import {
  $createAccountManagerRequestNode,
  $createAgentActivityNode,
  $createAgentContextNode,
  $createAgentSessionMentionNode,
  $createAwaitNode,
  $createBookingLinkMentionNode,
  $createConnectAppNode,
  $createContactMentionNode,
  $createCursorSystemNotificationNode,
  $createDatabaseQueryNode,
  $createDateMentionNode,
  $createDiffInsertNode,
  $createDocumentCardNode,
  $createDocumentMentionNode,
  $createEquationNode,
  $createGroupMentionNode,
  $createHorizontalRuleNode,
  $createHtmlRenderNode,
  $createImageNode,
  $createMagicChipNode,
  $createPasteNode,
  $createPullRequestMentionNode,
  $createReplyTargetNode,
  $createSnapshotNode,
  $createTagMentionNode,
  $createThemeMentionNode,
  $createUnknownMentionNode,
  $createUserMentionNode,
  $createVideoNode,
  $createWatermarkNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { getDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import {
  $createParagraphNode,
  $createTextNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';

const ID = '00000000-0000-7000-8000-000000000001';
const DOCUMENT = {
  documentId: ID,
  documentName: 'A document',
  blockName: 'md',
};

const FACTORIES: Record<string, () => LexicalNode> = {
  'account-manager-request': () => $createAccountManagerRequestNode(ID),
  'agent-activity': () =>
    $createAgentActivityNode({
      agentSessionId: ID,
      turn: 0,
      segment: 0,
      rows: [{ id: 'row', label: 'Read the document', status: 'completed' }],
      sealed: true,
    }),
  'agent-context': () =>
    $createAgentContextNode({ version: 1, text: 'Context for the agent' }),
  'agent-session-mention': () =>
    $createAgentSessionMentionNode({ id: ID, label: 'A session' }),
  await: () => $createAwaitNode({ awaitId: 'await', text: 'Waiting' }),
  'booking-link-mention': () =>
    $createBookingLinkMentionNode({
      profileId: 'profile',
      label: 'Book a time',
      url: 'https://macro.com/app/book/profile',
    }),
  'connect-app': () => $createConnectAppNode('github', 'GitHub'),
  'contact-mention': () =>
    $createContactMentionNode({
      contactId: ID,
      name: 'A Contact',
      emailOrDomain: 'contact@example.com',
      isCompany: false,
    }),
  'system-notification': () =>
    $createCursorSystemNotificationNode({
      source: 'timer',
      attributes: {},
      text: 'A timer fired',
    }),
  'database-query': () =>
    $createDatabaseQueryNode({
      queryId: '',
      prompt: 'How many rows?',
      displayMode: 'table',
    }),
  'date-mention': () =>
    $createDateMentionNode({
      date: '2026-01-02T00:00:00.000Z',
      displayFormat: 'date',
    }),
  'diff-insert': () => $createDiffInsertNode('An inserted line'),
  'document-card': () => $createDocumentCardNode(DOCUMENT),
  'document-mention': () => $createDocumentMentionNode(DOCUMENT),
  equation: () => $createEquationNode('x^2', true),
  'group-mention': () => $createGroupMentionNode({ groupAlias: 'everyone' }),
  horizontalrule: () => $createHorizontalRuleNode(),
  'html-render': () => $createHtmlRenderNode({ html: '<p>Rendered</p>' }),
  image: () =>
    $createImageNode({
      srcType: 'url',
      url: 'https://example.com/picture-0.png',
      alt: '',
      width: 0,
      height: 0,
      id: '',
    }),
  'magic-chip': () =>
    $createMagicChipNode({
      agentSessionId: ID,
      promptedMessage: null,
      status: 'no_messages',
    }),
  paste: () => $createPasteNode({ content: 'Pasted text' }),
  'pr-mention': () =>
    $createPullRequestMentionNode({
      id: '',
      url: 'https://github.com/example/example/pull/1',
    }),
  'reply-target': () =>
    $createReplyTargetNode({
      parent: { type: 'channel', id: ID },
      targetMessageId: ID,
      targetThreadId: ID,
      displayText: 'A message',
      senderId: 'macro|user@example.com',
    }),
  snapshot: () => $createSnapshotNode({ ...DOCUMENT, content: 'Snapshot' }),
  'tag-mention': () =>
    $createTagMentionNode({
      optionId: 'option',
      propertyDefinitionId: ID,
      scope: 'team',
      name: 'A tag',
    }),
  'theme-mention': () => $createThemeMentionNode('A theme', {}),
  'unknown-mention': () => $createUnknownMentionNode({ name: 'future-thing' }),
  'user-mention': () =>
    $createUserMentionNode({
      userId: 'macro|user@example.com',
      email: 'user@example.com',
    }),
  video: () =>
    $createVideoNode({
      srcType: 'url',
      url: 'https://example.com/clip-0.mp4',
      width: 0,
      height: 0,
      id: '',
    }),
  watermark: () => $createWatermarkNode({ content: 'Watermark' }),
};

/** Decorator types the editor supports and the app renders. */
export function renderedDecoratorTypes(): string[] {
  return SupportedNodeTypes.filter(
    (klass) => getDecorator(klass) !== undefined
  ).map((klass) => klass.getType());
}

/** Rendered decorator types this module cannot create. */
export function missingDecoratorTypes(): string[] {
  return renderedDecoratorTypes().filter((type) => !(type in FACTORIES));
}

/**
 * Puts one of every decorator after `block`: inline ones in a paragraph of
 * their own, block ones each at the top level. Returns the types it added.
 */
export function $insertEveryDecorator(block: ElementNode): string[] {
  const inline = $createParagraphNode().append($createTextNode('Inline: '));
  const blocks: LexicalNode[] = [];
  for (const type of renderedDecoratorTypes()) {
    const create = FACTORIES[type];
    if (!create) continue;
    const node = create();
    if (node.isInline()) inline.append(node, $createTextNode(' '));
    else blocks.push(node);
  }
  let last: LexicalNode = block.insertAfter(inline);
  for (const node of blocks) last = last.insertAfter(node);
  return renderedDecoratorTypes().filter((type) => type in FACTORIES);
}
