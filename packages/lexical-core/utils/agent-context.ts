import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $createAgentContextNode } from '../nodes/AgentContextNode';
import { ALL_TRANSFORMERS } from '../transformers';

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

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

function attributes(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
}

function element(
  indent: string,
  name: string,
  attrs: Record<string, string | undefined>,
  text: string
): string {
  return `${indent}<${name}${attributes(attrs)}>${escapeText(text)}</${name}>`;
}

function renderMessage(
  indent: string,
  message: AgentContextMessage,
  promptMessageId: string | undefined
): string {
  return element(
    indent,
    'message',
    {
      id: message.id,
      author: message.author,
      author_id: message.senderId,
      at: message.postedAt,
      mentioned_you: message.id === promptMessageId ? 'true' : undefined,
    },
    message.content
  );
}

function renderThread(
  indent: string,
  thread: AgentContextThread,
  promptMessageId: string | undefined
): string[] {
  const inner = `${indent}  `;
  return [
    `${indent}<thread${attributes({
      root: thread.rootId,
      messages_omitted: thread.messagesOmitted ? 'true' : undefined,
    })}>`,
    ...(thread.messagesOmitted
      ? [
          element(
            inner,
            'note',
            {},
            'Some messages of this thread are not shown.'
          ),
        ]
      : []),
    ...thread.messages.map((message) =>
      renderMessage(inner, message, promptMessageId)
    ),
    `${indent}</thread>`,
  ];
}

/**
 * Name the conversation a prompt came from, and that it came from there. A
 * prompt driven from the agent session view carries no parent, so a parent
 * is also the one signal that the reply is posted back into a thread nobody
 * is watching the session for - which changes how the agent should ask the
 * user anything.
 */
function describeOrigin(parent: AgentContextParent): string {
  const surface =
    parent.type === 'channel'
      ? 'a channel thread'
      : 'a document comment thread';
  return `This prompt was posted in ${surface}, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.`;
}

function renderReplyTarget(
  indent: string,
  target: AgentContextReplyTarget,
  promptMessageId: string | undefined
): string[] {
  const inner = `${indent}  `;
  switch (target.kind) {
    case 'quote':
      return [
        `${indent}<reply_target${attributes({
          kind: 'quote',
          message: target.messageId,
          thread: target.threadId,
        })}>`,
        element(
          inner,
          'note',
          {},
          'The prompt quote-replies to this message. It is what the prompt is about.'
        ),
        target.message
          ? renderMessage(inner, target.message, promptMessageId)
          : element(inner, 'preview', {}, target.preview),
        `${indent}</reply_target>`,
      ];
    case 'thread':
      return [
        `${indent}<reply_target${attributes({
          kind: 'thread',
          thread: target.threadId,
        })}>`,
        element(
          inner,
          'note',
          {},
          'The prompt was posted as a reply in the thread below. It is about that thread.'
        ),
        `${indent}</reply_target>`,
      ];
    case 'none':
      return [
        `${indent}<reply_target kind="none">`,
        element(
          inner,
          'note',
          {},
          'The prompt was posted at the top level of the channel and replies to no particular message.'
        ),
        `${indent}</reply_target>`,
      ];
  }
}

/**
 * Name the document range a comment marks. The mark id identifies it, but
 * nothing the agent can read maps that id back onto text, so the text travels
 * with it: as the document reads now when it could be resolved, and as it read
 * when the comment was posted, which is all there is when the live lookup
 * failed or the text has since been removed. A PDF highlight carries its own
 * text; a pin covers none, and says so rather than leaving the agent to guess.
 */
function renderAnchor(indent: string, anchor: AgentContextAnchor): string[] {
  const inner = `${indent}  `;
  const note = (text: string) => element(inner, 'note', {}, text);
  if (anchor.type === 'pdfPin') {
    return [
      `${indent}<anchor${attributes({ type: 'pdf_pin', pin: anchor.anchorId })}>`,
      note(
        'The comment is pinned to a point on a PDF page rather than to text, so it covers no words.'
      ),
      `${indent}</anchor>`,
    ];
  }
  if (anchor.type === 'pdfHighlight') {
    return [
      `${indent}<anchor${attributes({
        type: 'pdf_highlight',
        highlight: anchor.anchorId,
      })}>`,
      anchor.markedText === undefined
        ? note(
            'The PDF highlight carries no text, so which words it covers is not known.'
          )
        : element(inner, 'marked_text', {}, anchor.markedText),
      `${indent}</anchor>`,
    ];
  }
  const lines = [
    `${indent}<anchor${attributes({ type: 'markdown', mark: anchor.markId })}>`,
  ];
  if (anchor.currentMarkedText !== undefined) {
    lines.push(
      note(
        'marked_text is what the mark covers in the document now and surrounding_text the passage around it.'
      ),
      element(inner, 'marked_text', {}, anchor.currentMarkedText)
    );
    if (anchor.surroundingText !== undefined) {
      lines.push(
        element(inner, 'surrounding_text', {}, anchor.surroundingText)
      );
    }
    if (
      anchor.markedText !== undefined &&
      anchor.markedText !== anchor.currentMarkedText
    ) {
      lines.push(
        element(inner, 'marked_text_when_posted', {}, anchor.markedText)
      );
    }
  } else if (anchor.markedText !== undefined) {
    lines.push(
      note(
        'marked_text_when_posted is what the mark covered when the comment was posted; the document may have changed since.'
      ),
      element(inner, 'marked_text_when_posted', {}, anchor.markedText)
    );
  }
  lines.push(`${indent}</anchor>`);
  return lines;
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
  if (
    !input.parent &&
    !input.anchor &&
    !input.replyTarget &&
    !input.thread &&
    channel.length === 0
  ) {
    return undefined;
  }
  const indent = '  ';
  const lines = [
    `<conversation${attributes({ type: input.parent?.type, id: input.parent?.id })}>`,
  ];
  if (input.parent) {
    lines.push(element(indent, 'origin', {}, describeOrigin(input.parent)));
  }
  if (input.replyTarget) {
    lines.push(
      ...renderReplyTarget(indent, input.replyTarget, input.promptMessageId)
    );
  }
  if (input.anchor) lines.push(...renderAnchor(indent, input.anchor));
  if (input.thread) {
    lines.push(...renderThread(indent, input.thread, input.promptMessageId));
  }
  if (channel.length > 0) {
    lines.push(
      ...renderChannel(
        indent,
        channel,
        input.thread !== undefined,
        input.promptMessageId
      )
    );
  }
  lines.push('</conversation>');
  return lines.join('\n');
}

/**
 * Channel activity: background beside the prompt's own thread, or the
 * primary context for a top-level prompt. A lone top-level message is written
 * bare; anything with replies keeps its thread.
 */
function renderChannel(
  indent: string,
  channel: AgentContextThread[],
  besideThread: boolean,
  promptMessageId: string | undefined
): string[] {
  const tag = besideThread ? 'channel_background' : 'channel_recent';
  const inner = `${indent}  `;
  const lines = [
    `${indent}<${tag}>`,
    element(
      inner,
      'note',
      {},
      besideThread
        ? 'Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the prompt is about.'
        : 'Recent messages in this channel, grouped by thread, oldest first.'
    ),
  ];
  for (const thread of channel) {
    const [only] = thread.messages;
    if (
      thread.messages.length === 1 &&
      only &&
      only.id === thread.rootId &&
      !thread.messagesOmitted
    ) {
      lines.push(renderMessage(inner, only, promptMessageId));
    } else {
      lines.push(...renderThread(inner, thread, promptMessageId));
    }
  }
  lines.push(`${indent}</${tag}>`);
  return lines;
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
