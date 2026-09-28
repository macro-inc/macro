import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { match, P } from 'ts-pattern';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createAgentContextNode } from '../nodes/AgentContextNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { buildXml } from '../transformers/xml';
import { el, type FxpNode } from '../transformers/xml/codecs';

/** A message supplied as untrusted agent context. */
export type AgentContextMessage = {
  id: string;
  senderId: string;
  /** Readable name of the sender. */
  author: string;
  content: string;
  /** RFC 3339 time the message was posted. */
  postedAt: string;
};

/** Messages of one discussion, oldest first. */
export type AgentContextThread = {
  rootId: string;
  messages: AgentContextMessage[];
  /** Some messages of the discussion were left out. */
  messagesOmitted: boolean;
};

/** What a prompt answers. */
export type AgentContextReplyTarget =
  | {
      kind: 'quote';
      messageId: string;
      threadId: string;
      preview: string;
      /** Absent when the quoted message is in another conversation. */
      message?: AgentContextMessage;
    }
  | { kind: 'thread'; threadId: string }
  | { kind: 'none' };

/** The authorized conversation a prompt was posted in. */
export type AgentContextParent = {
  type: 'channel' | 'document';
  id: string;
};

/** A comment mark in a markdown document. Older callers omit `type`. */
export type MarkdownCommentAnchor = {
  type?: 'markdown';
  markId: string;
  /** What the mark covered when the comment was posted; absent on threads anchored before it was captured. */
  markedText?: string;
  /** What the mark covers in the document now, when it could be resolved. */
  currentMarkedText?: string;
  /** The passage around the mark now, when it could be resolved. */
  surroundingText?: string;
};

/** A highlight on a PDF. */
export type PdfHighlightCommentAnchor = {
  type: 'pdfHighlight';
  anchorId: string;
  /** The text the highlight covers; absent when the highlight carries none. */
  markedText?: string;
};

/** A point pinned on a PDF page, which covers no text. */
export type PdfPinCommentAnchor = {
  type: 'pdfPin';
  anchorId: string;
};

/** Where in a document the comment thread a prompt was posted in sits. */
export type AgentContextAnchor =
  | MarkdownCommentAnchor
  | PdfHighlightCommentAnchor
  | PdfPinCommentAnchor;

/** Input used to compose an agent prompt with private conversation context. */
export type AgentContextPrompt = {
  promptMarkdown: string;
  /** Supplied by the message service, never by the prompt's author. */
  parent?: AgentContextParent;
  anchor?: AgentContextAnchor;
  replyTarget?: AgentContextReplyTarget;
  /** The prompting message, marked where it appears in the context. */
  promptMessageId?: string;
  /** The discussion the prompt was posted in, through the prompt. */
  thread?: AgentContextThread;
  /** Other channel activity, grouped by discussion, oldest first. */
  channel?: AgentContextThread[];
};

const text = (value: string): FxpNode => ({ '#text': value });
const note = (value: string): FxpNode => el('note', [text(value)]);

/** Attributes with the absent ones dropped. */
function present(
  values: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

function messageNode(
  message: AgentContextMessage,
  promptMessageId: string | undefined
): FxpNode {
  return el(
    'message',
    [text(message.content)],
    present({
      id: message.id,
      author: message.author,
      author_id: message.senderId,
      at: message.postedAt,
      mentioned_you: message.id === promptMessageId ? 'true' : undefined,
    })
  );
}

function threadNode(
  thread: AgentContextThread,
  promptMessageId: string | undefined
): FxpNode {
  return el(
    'thread',
    [
      ...(thread.messagesOmitted
        ? [note('Some messages of this thread are not shown.')]
        : []),
      ...thread.messages.map((message) =>
        messageNode(message, promptMessageId)
      ),
    ],
    present({
      root: thread.rootId,
      messages_omitted: thread.messagesOmitted ? 'true' : undefined,
    })
  );
}

/**
 * Name the conversation a prompt came from, and that it came from there. A
 * prompt driven from the agent session view carries no parent, so a parent
 * is also the one signal that the reply is posted back into a thread nobody
 * is watching the session for - which changes how the agent should ask the
 * user anything.
 */
function describeOrigin(parent: AgentContextParent): string {
  const surface = match(parent.type)
    .with('channel', () => 'a channel thread')
    .with('document', () => 'a document comment thread')
    .exhaustive();
  return `This prompt was posted in ${surface}, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.`;
}

function replyTargetNode(
  target: AgentContextReplyTarget,
  promptMessageId: string | undefined
): FxpNode {
  return match(target)
    .with({ kind: 'quote' }, (quote) =>
      el(
        'reply_target',
        [
          note(
            'The prompt quote-replies to this message. It is what the prompt is about.'
          ),
          quote.message
            ? messageNode(quote.message, promptMessageId)
            : el('preview', [text(quote.preview)]),
        ],
        { kind: 'quote', message: quote.messageId, thread: quote.threadId }
      )
    )
    .with({ kind: 'thread' }, ({ threadId }) =>
      el(
        'reply_target',
        [
          note(
            'The prompt was posted as a reply in the thread below. It is about that thread.'
          ),
        ],
        { kind: 'thread', thread: threadId }
      )
    )
    .with({ kind: 'none' }, () =>
      el(
        'reply_target',
        [
          note(
            'The prompt was posted at the top level of the channel and replies to no particular message.'
          ),
        ],
        { kind: 'none' }
      )
    )
    .exhaustive();
}

/**
 * What a comment mark covers: as the document reads now when it could be
 * resolved, beside the snapshot when an edit changed it, and the snapshot
 * alone when the live lookup failed or the text has since been removed.
 */
function markChildren(mark: MarkdownCommentAnchor): FxpNode[] {
  return match(mark)
    .with(
      { currentMarkedText: P.string },
      ({ currentMarkedText, surroundingText, markedText }) => [
        note(
          'marked_text is what the mark covers in the document now and surrounding_text the passage around it.'
        ),
        el('marked_text', [text(currentMarkedText)]),
        ...(surroundingText === undefined
          ? []
          : [el('surrounding_text', [text(surroundingText)])]),
        ...(markedText === undefined || markedText === currentMarkedText
          ? []
          : [el('marked_text_when_posted', [text(markedText)])]),
      ]
    )
    .with({ markedText: P.string }, ({ markedText }) => [
      note(
        'marked_text_when_posted is what the mark covered when the comment was posted; the document may have changed since.'
      ),
      el('marked_text_when_posted', [text(markedText)]),
    ])
    .otherwise(() => []);
}

/**
 * Name the document range a comment marks. The mark id identifies it, but
 * nothing the agent can read maps that id back onto text, so the text travels
 * with it. A PDF highlight carries its own text; a pin covers none, and says
 * so rather than leaving the agent to guess.
 */
function anchorNode(anchor: AgentContextAnchor): FxpNode {
  return match(anchor)
    .with({ type: 'pdfPin' }, ({ anchorId }) =>
      el(
        'anchor',
        [
          note(
            'The comment is pinned to a point on a PDF page rather than to text, so it covers no words.'
          ),
        ],
        { type: 'pdf_pin', pin: anchorId }
      )
    )
    .with({ type: 'pdfHighlight' }, ({ anchorId, markedText }) =>
      el(
        'anchor',
        [
          markedText === undefined
            ? note(
                'The PDF highlight carries no text, so which words it covers is not known.'
              )
            : el('marked_text', [text(markedText)]),
        ],
        { type: 'pdf_highlight', highlight: anchorId }
      )
    )
    .with({ type: P.optional('markdown') }, (mark) =>
      el('anchor', markChildren(mark), { type: 'markdown', mark: mark.markId })
    )
    .exhaustive();
}

/**
 * Channel activity: background beside the prompt's own thread, or the
 * primary context for a top-level prompt. A lone top-level message is written
 * bare; anything with replies keeps its thread.
 */
function channelNode(
  channel: AgentContextThread[],
  besideThread: boolean,
  promptMessageId: string | undefined
): FxpNode {
  const children = channel.map((thread) =>
    match(thread)
      .with(
        {
          messagesOmitted: false,
          messages: [P.select({ id: thread.rootId })],
        },
        (only) => messageNode(only, promptMessageId)
      )
      .otherwise(() => threadNode(thread, promptMessageId))
  );
  return besideThread
    ? el('channel_background', [
        note(
          'Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the prompt is about.'
        ),
        ...children,
      ])
    : el('channel_recent', [
        note(
          'Recent messages in this channel, grouped by thread, oldest first.'
        ),
        ...children,
      ]);
}

/**
 * Render the conversation a prompt was posted in, keeping its structure: the
 * prompt's own thread first and whole, the channel around it grouped by
 * thread and labeled as background, and the message the prompt answers named
 * outright. A flat history leaves the agent to guess which of several bugs
 * "please fix" means.
 */
function renderConversation(input: AgentContextPrompt): string | undefined {
  const channel = input.channel ?? [];
  const children: FxpNode[] = [
    ...(input.parent
      ? [el('origin', [text(describeOrigin(input.parent))])]
      : []),
    ...(input.replyTarget
      ? [replyTargetNode(input.replyTarget, input.promptMessageId)]
      : []),
    ...(input.anchor ? [anchorNode(input.anchor)] : []),
    ...(input.thread ? [threadNode(input.thread, input.promptMessageId)] : []),
    ...(channel.length > 0
      ? [
          channelNode(
            channel,
            input.thread !== undefined,
            input.promptMessageId
          ),
        ]
      : []),
  ];
  if (children.length === 0) return undefined;
  return buildXml([
    el(
      'conversation',
      children,
      present({ type: input.parent?.type, id: input.parent?.id })
    ),
    // The builder opens with a newline when formatting.
  ]).trimStart();
}

function escapeAgentContextTags(markdown: string): string {
  // No user-authored entity may decode into reserved syntax during import.
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/<m-agent-context>/g, '&amp;lt;m-agent-context>')
    .replace(/<\/m-agent-context>/g, '&amp;lt;/m-agent-context>');
}

/**
 * Prefix a prompt with a private AgentContext node holding the conversation
 * it came from. The internal markdown transformer owns envelope encoding.
 */
export function composeAgentContextPrompt(input: AgentContextPrompt): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(
        escapeAgentContextTags(input.promptMarkdown),
        ALL_TRANSFORMERS
      );
    },
    { discrete: true }
  );

  editor.update(
    () => {
      const conversation = renderConversation(input);
      if (conversation === undefined) return;

      const context = $createAgentContextNode({
        version: 1,
        text: conversation,
      });
      const firstChild = $getRoot().getFirstChild();
      if (firstChild) firstChild.insertBefore(context);
      else $getRoot().append(context);
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
