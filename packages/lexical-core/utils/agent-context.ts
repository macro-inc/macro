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
import { markdownToEmbeddingText } from './parsers';

/**
 * Why an agent was called, and what about. Mirrors the Rust `TriggerContext`
 * in `crates/trigger_context/src/lib.rs` exactly as it arrives on the
 * wire: snake_case fields, optional fields absent rather than null.
 */
export type TriggerContext =
  | ({ kind: 'mentioned' } & DiscussionContext)
  | ({ kind: 'follow_up' } & FollowUpContext)
  | ({ kind: 'task_assigned' } & TaskAssignedContext)
  | ({ kind: 'requested' } & RequestedContext)
  | ({ kind: 'dispatched' } & DispatchedContext)
  | ({ kind: 'routine' } & RoutineContext);

/** A person or bot, as a reader would name them. */
export type ContextPerson = {
  /** A Macro user id or a bot id. */
  id: string;
  name: string;
  /** Absent for bots and imported authors. */
  email?: string;
};

/** A message the agent may read. */
export type ContextMessage = {
  id: string;
  author: ContextPerson;
  /** Internal markdown. */
  content: string;
  posted_at: string;
};

/** Messages of one discussion, oldest first. */
export type ContextThread = {
  root_id: string;
  messages: ContextMessage[];
  messages_omitted: boolean;
};

/** The discussion a message was posted in. */
export type DiscussionContext = {
  surface: DiscussionSurface;
  prompt_message_id: string;
  sender: ContextPerson;
  reply_target: ReplyTarget;
  /** Absent for a top-level channel message. */
  thread?: ContextThread;
  /** Absent when empty. */
  channel?: ContextThread[];
};

export type ChannelType = 'public' | 'private' | 'direct_message' | 'team';

/** Where a discussion lives. */
export type DiscussionSurface =
  | {
      type: 'channel';
      id: string;
      /** Direct messages have none. */
      name?: string;
      channel_type: ChannelType;
    }
  | {
      type: 'document_comment';
      id: string;
      name: string;
      anchor?: CommentAnchor;
    }
  | { type: 'project_comment'; id: string; name: string }
  | { type: 'crm_company_comment'; id: string; name: string }
  | { type: 'crm_contact_comment'; id: string; name: string }
  | { type: 'call_chat'; id: string; title: string };

/** What a message answers. */
export type ReplyTarget =
  | {
      kind: 'quote';
      message_id: string;
      thread_id: string;
      preview: string;
      /** Absent when the quoted message is elsewhere or unreadable. */
      message?: ContextMessage;
    }
  | { kind: 'thread'; root_id: string }
  | { kind: 'none' };

/** Where in a document a comment thread sits. */
export type CommentAnchor =
  | { type: 'spreadsheet'; sheet_id: string; sheet_name: string; range: string }
  | {
      type: 'mark';
      mark_id: string;
      /** The marked text when the comment was posted. */
      marked_text?: string;
      /** The mark as the document reads now. */
      current?: MarkedPassage;
    }
  | { type: 'pdf_highlight'; anchor_id: string; marked_text?: string }
  | { type: 'pdf_pin'; anchor_id: string };

/** A comment mark resolved against the live document. */
export type MarkedPassage = { marked_text: string; surrounding_text: string };

/** How a follow-up was attributed to the agent. */
export type AddressedBy = 'mention' | 'explicit_reply' | 'inferred';

/** A message for a session that is already running. */
export type FollowUpContext = {
  addressed_by: AddressedBy;
  discussion: DiscussionContext;
};

/** A task handed to the agent. */
export type TaskAssignedContext = {
  task: TaskSnapshot;
  assigned_by: ContextPerson;
  assigned_at: string;
  /** The agent's own discussion on the task, where it answers. */
  discussion_id: string;
};

/** A task, read under the assigner's access. */
export type TaskSnapshot = {
  id: string;
  title: string;
  /** Description, in internal markdown. */
  markdown: string;
  status?: string;
  priority?: string;
  due?: string;
  /** Absent when empty. */
  assignees?: ContextPerson[];
  project?: ProjectRef;
};

/** A project, by name. */
export type ProjectRef = { id: string; name: string };

/** A session opened from the composer. */
export type RequestedContext = {
  requested_by: ContextPerson;
  requested_at: string;
  repo_url?: string;
};

/** A task handed over by another agent. */
export type DispatchedContext = {
  /** The user whose authority the work runs under. */
  dispatched_by: ContextPerson;
  dispatched_at: string;
  /** Rust sends null when absent. */
  from_bot?: string | null;
  from_session?: string;
  repo_url?: string;
};

/** A routine run. */
export type RoutineContext = {
  routine_id: string;
  name: string;
  owner: ContextPerson;
  /** What the routine asks for, as its owner wrote it. */
  instructions: string;
  triggers: RoutineTrigger[];
  firing: RoutineFiring;
};

/** One of the ways a routine runs. */
export type RoutineTrigger =
  | { type: 'schedule'; cron: string; timezone: string }
  | {
      type: 'events';
      events: string[];
      /** Absent when the routine watches every entity. */
      entity_ids?: string[];
      condition?: string;
    };

/** What made a routine fire. */
export type RoutineFiring =
  | { type: 'scheduled'; scheduled_for: string; schedule: string }
  | { type: 'manual'; requested_at: string }
  | {
      type: 'event';
      event: RoutineEvent;
      /** Questions the event was checked against; it answered yes to at least one. */
      conditions?: string[];
    };

/** The event a routine fired on. */
export type RoutineEvent =
  | { event: 'document_created'; document: DocumentSnapshot }
  | { event: 'document_updated'; document: DocumentSnapshot }
  | { event: 'document_deleted'; id: string; name: string }
  | { event: 'task_created'; task: TaskSnapshot }
  | { event: 'task_status_changed'; task: TaskSnapshot }
  | { event: 'task_priority_changed'; task: TaskSnapshot }
  /** The event does not record which property changed. */
  | { event: 'task_property_changed'; task: TaskSnapshot }
  | { event: 'email_received'; email: EmailSnapshot }
  | { event: 'channel_created'; id: string; name?: string }
  | { event: 'channel_message_posted'; discussion: DiscussionContext }
  | { event: 'channel_mentioned'; discussion: DiscussionContext }
  | { event: 'channel_message_patched'; discussion: DiscussionContext }
  | {
      event: 'channel_message_attachment_created';
      discussion: DiscussionContext;
      entity_type: string;
      entity_id: string;
    };

/** A document, read under the routine owner's access. */
export type DocumentSnapshot = {
  id: string;
  name: string;
  file_type: string;
  /** Absent for documents with no readable text. */
  text?: string;
};

/** An email, read under the routine owner's access. */
export type EmailSnapshot = {
  thread_id: string;
  subject: string;
  from: string;
  to: string[];
  received_at: string;
  /** Plain text. */
  body: string;
};

// LEGACY conversation fields. Remove these types, their renderer
// (`renderConversation` and helpers), and the matching AgentContextPrompt
// fields once every caller sends `trigger` instead.

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
  type:
    | 'channel'
    | 'document'
    | 'initiative'
    | 'crm_company'
    | 'crm_contact'
    | 'call';
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
  | PdfPinCommentAnchor
  | { type: 'spreadsheet'; sheetId: string; sheetName: string; range: string };

/** A person the session acts for or hears from. */
export type AgentContextPerson = {
  id: string;
  /** Readable name. */
  name: string;
};

/** Input used to compose an agent prompt with private conversation context. */
export type AgentContextPrompt = {
  promptMarkdown: string;
  /** Trusted session instructions supplied by the agent harness. */
  instructions?: string;
  /** Whose access the session runs with. Supplied by the harness. */
  owner?: AgentContextPerson;
  /** Who sent the prompt; absent when a bot sent it on nobody's behalf. */
  sender?: AgentContextPerson;
  /**
   * Why the agent was called. Supplied by the trigger pipeline, never by the
   * prompt's author. Cannot be combined with the legacy fields below.
   */
  trigger?: TriggerContext;
  /** LEGACY. Supplied by the message service, never by the prompt's author. */
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

/** Legacy conversation fields; none may travel beside `trigger`. */
export const LEGACY_CONVERSATION_FIELDS = [
  'parent',
  'anchor',
  'replyTarget',
  'promptMessageId',
  'thread',
  'channel',
] as const satisfies readonly (keyof AgentContextPrompt)[];

// LEGACY renderer, from here through `renderConversation`. Remove once every
// caller sends `trigger`.

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
    .with('initiative', () => 'a project comment thread')
    .with('crm_company', () => 'a CRM company comment thread')
    .with('crm_contact', () => 'a CRM contact comment thread')
    .with('call', () => 'a call chat thread')
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
    .with({ type: 'spreadsheet' }, ({ sheetId, sheetName, range }) =>
      el(
        'anchor',
        [note('Use ReadSpreadsheet to read the live cells in this range.')],
        { type: 'spreadsheet', sheetId, sheetName, range }
      )
    )
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
function renderConversation(input: AgentContextPrompt): FxpNode | undefined {
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
  return el(
    'conversation',
    children,
    present({ type: input.parent?.type, id: input.parent?.id })
  );
}

// End of the LEGACY renderer.

/** Message bodies as the model should read them: names, not mention JSON. */
const readable = (markdown: string): string =>
  markdownToEmbeddingText(markdown);

function personAttributes(
  person: ContextPerson,
  prefix: string
): Record<string, string | undefined> {
  return {
    [prefix]: person.name,
    [`${prefix}_email`]: person.email,
    [`${prefix}_id`]: person.id,
  };
}

function personNode(tag: string, person: ContextPerson): FxpNode {
  return el(
    tag,
    [],
    present({ name: person.name, email: person.email, id: person.id })
  );
}

/** How a discussion relates to the session reading it. */
type DiscussionReading = {
  /** Attribute marking the message that called the agent. */
  marker: string;
  /** What the notes call that message. */
  subject: 'prompt' | 'triggering message';
  /** Whether the agent's reply is posted back into the discussion. */
  repliesHere: boolean;
};

type MessageMarker = { attribute: string; messageId: string };

function contextMessageNode(
  message: ContextMessage,
  marker: MessageMarker
): FxpNode {
  return el(
    'message',
    [text(readable(message.content))],
    present({
      id: message.id,
      ...personAttributes(message.author, 'author'),
      at: message.posted_at,
      [marker.attribute]: message.id === marker.messageId ? 'true' : undefined,
    })
  );
}

function contextThreadNode(
  thread: ContextThread,
  marker: MessageMarker
): FxpNode {
  return el(
    'thread',
    [
      ...(thread.messages_omitted
        ? [note('Some messages of this thread are not shown.')]
        : []),
      ...thread.messages.map((message) => contextMessageNode(message, marker)),
    ],
    present({
      root: thread.root_id,
      messages_omitted: thread.messages_omitted ? 'true' : undefined,
    })
  );
}

function surfaceDescription(surface: DiscussionSurface): string {
  return match(surface)
    .with({ type: 'channel' }, () => 'a channel thread')
    .with({ type: 'document_comment' }, () => 'a document comment thread')
    .with({ type: 'project_comment' }, () => 'a project comment thread')
    .with({ type: 'crm_company_comment' }, () => 'a CRM company comment thread')
    .with({ type: 'crm_contact_comment' }, () => 'a CRM contact comment thread')
    .with({ type: 'call_chat' }, () => 'a call chat thread')
    .exhaustive();
}

/** Same building blocks as the legacy `anchorNode`, over the wire types. */
function commentAnchorNode(anchor: CommentAnchor): FxpNode {
  return match(anchor)
    .with({ type: 'spreadsheet' }, ({ sheet_id, sheet_name, range }) =>
      el(
        'anchor',
        [note('Use ReadSpreadsheet to read the live cells in this range.')],
        { type: 'spreadsheet', sheet_id, sheet_name, range }
      )
    )
    .with({ type: 'pdf_pin' }, ({ anchor_id }) =>
      el(
        'anchor',
        [
          note(
            'The comment is pinned to a point on a PDF page rather than to text, so it covers no words.'
          ),
        ],
        { type: 'pdf_pin', pin: anchor_id }
      )
    )
    .with({ type: 'pdf_highlight' }, ({ anchor_id, marked_text }) =>
      el(
        'anchor',
        [
          marked_text === undefined
            ? note(
                'The PDF highlight carries no text, so which words it covers is not known.'
              )
            : el('marked_text', [text(marked_text)]),
        ],
        { type: 'pdf_highlight', highlight: anchor_id }
      )
    )
    .with({ type: 'mark' }, (mark) =>
      el('anchor', markPassageChildren(mark), {
        type: 'mark',
        mark: mark.mark_id,
      })
    )
    .exhaustive();
}

function markPassageChildren(
  mark: Extract<CommentAnchor, { type: 'mark' }>
): FxpNode[] {
  return match(mark)
    .with({ current: P.nonNullable }, ({ current, marked_text }) => [
      note(
        'marked_text is what the mark covers in the document now and surrounding_text the passage around it.'
      ),
      el('marked_text', [text(current.marked_text)]),
      el('surrounding_text', [text(current.surrounding_text)]),
      ...(marked_text === undefined || marked_text === current.marked_text
        ? []
        : [el('marked_text_when_posted', [text(marked_text)])]),
    ])
    .with({ marked_text: P.string }, ({ marked_text }) => [
      note(
        'marked_text_when_posted is what the mark covered when the comment was posted; the document may have changed since.'
      ),
      el('marked_text_when_posted', [text(marked_text)]),
    ])
    .otherwise(() => []);
}

/** Where a discussion lives, named; a document carries its comment anchor. */
function surfaceNode(surface: DiscussionSurface): FxpNode {
  return match(surface)
    .with({ type: 'channel' }, ({ id, name, channel_type }) =>
      el('channel', [], present({ id, name, type: channel_type }))
    )
    .with({ type: 'document_comment' }, ({ id, name, anchor }) =>
      el('document', anchor ? [commentAnchorNode(anchor)] : [], { id, name })
    )
    .with({ type: 'project_comment' }, ({ id, name }) =>
      el('project', [], { id, name })
    )
    .with({ type: 'crm_company_comment' }, ({ id, name }) =>
      el('crm_company', [], { id, name })
    )
    .with({ type: 'crm_contact_comment' }, ({ id, name }) =>
      el('crm_contact', [], { id, name })
    )
    .with({ type: 'call_chat' }, ({ id, title }) =>
      el('call', [], { id, title })
    )
    .exhaustive();
}

function contextReplyTargetNode(
  target: ReplyTarget,
  marker: MessageMarker,
  subject: DiscussionReading['subject']
): FxpNode {
  const Subject = `The ${subject}`;
  return match(target)
    .with({ kind: 'quote' }, (quote) =>
      el(
        'reply_target',
        [
          note(
            `${Subject} quote-replies to this message. It is what the ${subject} is about.`
          ),
          quote.message
            ? contextMessageNode(quote.message, marker)
            : el('preview', [text(readable(quote.preview))]),
        ],
        { kind: 'quote', message: quote.message_id, thread: quote.thread_id }
      )
    )
    .with({ kind: 'thread' }, ({ root_id }) =>
      el(
        'reply_target',
        [
          note(
            `${Subject} was posted as a reply in the thread below. It is about that thread.`
          ),
        ],
        { kind: 'thread', thread: root_id }
      )
    )
    .with({ kind: 'none' }, () =>
      el(
        'reply_target',
        [
          note(
            `${Subject} was posted at the top level of the channel and replies to no particular message.`
          ),
        ],
        { kind: 'none' }
      )
    )
    .exhaustive();
}

function contextChannelNode(
  channel: ContextThread[],
  besideThread: boolean,
  marker: MessageMarker,
  subject: DiscussionReading['subject']
): FxpNode {
  const children = channel.map((thread) =>
    match(thread)
      .with(
        {
          messages_omitted: false,
          messages: [P.select({ id: thread.root_id })],
        },
        (only) => contextMessageNode(only, marker)
      )
      .otherwise(() => contextThreadNode(thread, marker))
  );
  return besideThread
    ? el('channel_background', [
        note(
          `Other recent messages in this channel, outside the thread above, oldest first. Background only: they are not what the ${subject} is about.`
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
 * A discussion with its structure kept: where it lives, the message it
 * answers named outright, its own thread whole, and the channel around it
 * labeled as background.
 */
function discussionNode(
  discussion: DiscussionContext,
  reading: DiscussionReading
): FxpNode {
  const marker = {
    attribute: reading.marker,
    messageId: discussion.prompt_message_id,
  };
  const channel = discussion.channel ?? [];
  return el('discussion', [
    surfaceNode(discussion.surface),
    ...(reading.repliesHere
      ? [
          el('origin', [
            text(
              `This ${reading.subject} was posted in ${surfaceDescription(discussion.surface)}, not the agent session view. Your reply is posted back into that thread, and it is where the user will answer anything you ask.`
            ),
          ]),
        ]
      : []),
    personNode('sender', discussion.sender),
    contextReplyTargetNode(discussion.reply_target, marker, reading.subject),
    ...(discussion.thread
      ? [contextThreadNode(discussion.thread, marker)]
      : []),
    ...(channel.length > 0
      ? [
          contextChannelNode(
            channel,
            discussion.thread !== undefined,
            marker,
            reading.subject
          ),
        ]
      : []),
  ]);
}

function taskNode(task: TaskSnapshot): FxpNode {
  const assignees = task.assignees ?? [];
  const description = readable(task.markdown);
  return el(
    'task',
    [
      ...(task.project
        ? [el('project', [], { id: task.project.id, name: task.project.name })]
        : []),
      ...(assignees.length > 0
        ? [
            el(
              'assignees',
              assignees.map((assignee) => personNode('assignee', assignee))
            ),
          ]
        : []),
      ...(description.trim() ? [el('description', [text(description)])] : []),
    ],
    present({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due: task.due,
    })
  );
}

function documentNode(document: DocumentSnapshot): FxpNode {
  return el(
    'document',
    document.text === undefined ? [] : [text(readable(document.text))],
    { id: document.id, name: document.name, file_type: document.file_type }
  );
}

function mentionedNode(discussion: DiscussionContext): FxpNode {
  return el(
    'trigger',
    [
      note(
        `${discussion.sender.name} mentioned you, and that mention opened this session. Their message is the prompt.`
      ),
      discussionNode(discussion, {
        marker: 'mentioned_you',
        subject: 'prompt',
        repliesHere: true,
      }),
    ],
    { kind: 'mentioned' }
  );
}

function followUpNode({ addressed_by, discussion }: FollowUpContext): FxpNode {
  const { marker, explanation } = match(addressed_by)
    .with('mention', () => ({
      marker: 'mentioned_you',
      explanation: 'It mentions you.',
    }))
    .with('explicit_reply', () => ({
      marker: 'replied_to_you',
      explanation:
        'It quote-replies to one of your messages without mentioning you.',
    }))
    .with('inferred', () => ({
      marker: 'addressed_to_you',
      explanation:
        'It neither mentions you nor quote-replies to you: a model judged from the discussion that it was meant for you. That judgment can be wrong, so if the message reads as meant for someone else, say so briefly instead of acting on it.',
    }))
    .exhaustive();
  return el(
    'trigger',
    [
      note(
        `This session was already running when ${discussion.sender.name} posted this message in its discussion. ${explanation} The message is the prompt.`
      ),
      discussionNode(discussion, {
        marker,
        subject: 'prompt',
        repliesHere: true,
      }),
    ],
    { kind: 'follow_up', addressed_by }
  );
}

function taskAssignedNode(context: TaskAssignedContext): FxpNode {
  const assigner = context.assigned_by.name;
  return el(
    'trigger',
    [
      note(
        `${assigner} assigned you this task. Your replies are posted to your own discussion on the task, where ${assigner} and others on the task read them.`
      ),
      el(
        'assigned',
        [],
        present({
          ...personAttributes(context.assigned_by, 'by'),
          at: context.assigned_at,
        })
      ),
      taskNode(context.task),
    ],
    { kind: 'task_assigned', discussion: context.discussion_id }
  );
}

function requestedNode(context: RequestedContext): FxpNode {
  return el(
    'trigger',
    [
      note(
        `${context.requested_by.name} opened this session from the composer. Their prompt follows.`
      ),
      el(
        'requested',
        [],
        present({
          ...personAttributes(context.requested_by, 'by'),
          at: context.requested_at,
          repo: context.repo_url,
        })
      ),
    ],
    { kind: 'requested' }
  );
}

function dispatchedNode(context: DispatchedContext): FxpNode {
  return el(
    'trigger',
    [
      note(
        `Another agent handed you this task on behalf of ${context.dispatched_by.name}. The prompt is the task it handed over.`
      ),
      el(
        'dispatched',
        [],
        present({
          ...personAttributes(context.dispatched_by, 'by'),
          at: context.dispatched_at,
          from_bot: context.from_bot ?? undefined,
          from_session: context.from_session,
          repo: context.repo_url,
        })
      ),
    ],
    { kind: 'dispatched' }
  );
}

const routineDiscussion: DiscussionReading = {
  marker: 'fired_routine',
  subject: 'triggering message',
  repliesHere: false,
};

function routineEventChildren(event: RoutineEvent): FxpNode[] {
  return match(event)
    .with(
      { event: P.union('document_created', 'document_updated') },
      ({ document }) => [documentNode(document)]
    )
    .with({ event: 'document_deleted' }, ({ id, name }) => [
      el('document', [], { id, name }),
    ])
    .with({ event: 'task_created' }, ({ task }) => [taskNode(task)])
    .with({ event: 'task_status_changed' }, ({ task }) => [
      el('change', [], present({ property: 'status', to: task.status })),
      taskNode(task),
    ])
    .with({ event: 'task_priority_changed' }, ({ task }) => [
      el('change', [], present({ property: 'priority', to: task.priority })),
      taskNode(task),
    ])
    .with({ event: 'task_property_changed' }, ({ task }) => [
      el('change', [
        note(
          "One of the task's properties changed; which one is not recorded."
        ),
      ]),
      taskNode(task),
    ])
    .with({ event: 'email_received' }, ({ email }) => [
      el('email', [el('body', [text(email.body)])], {
        thread: email.thread_id,
        subject: email.subject,
        from: email.from,
        to: email.to.join(', '),
        received_at: email.received_at,
      }),
    ])
    .with({ event: 'channel_created' }, ({ id, name }) => [
      el('channel', [], present({ id, name })),
    ])
    .with(
      {
        event: P.union(
          'channel_message_posted',
          'channel_mentioned',
          'channel_message_patched'
        ),
      },
      ({ discussion }) => [discussionNode(discussion, routineDiscussion)]
    )
    .with(
      { event: 'channel_message_attachment_created' },
      ({ discussion, entity_type, entity_id }) => [
        el('attachment', [], { entity_type, entity_id }),
        discussionNode(discussion, routineDiscussion),
      ]
    )
    .exhaustive();
}

function routineFiringNodes(firing: RoutineFiring): FxpNode[] {
  return match(firing)
    .with({ type: 'scheduled' }, ({ scheduled_for, schedule }) => [
      el(
        'scheduled',
        [note('The routine ran because its schedule came due.')],
        {
          for: scheduled_for,
          schedule,
        }
      ),
    ])
    .with({ type: 'manual' }, ({ requested_at }) => [
      el('manual', [note("The routine's owner started this run by hand.")], {
        requested_at,
      }),
    ])
    .with({ type: 'event' }, ({ event, conditions }) => [
      el('event', routineEventChildren(event), { type: event.event }),
      ...(conditions === undefined || conditions.length === 0
        ? []
        : [
            el('conditions', [
              note('The event answered yes to at least one of these.'),
              ...conditions.map((condition) =>
                el('condition', [text(condition)])
              ),
            ]),
          ]),
    ])
    .exhaustive();
}

function routineTriggerNode(trigger: RoutineTrigger): FxpNode {
  return match(trigger)
    .with({ type: 'schedule' }, ({ cron, timezone }) =>
      el('schedule', [], { cron, timezone })
    )
    .with({ type: 'events' }, ({ events, entity_ids, condition }) =>
      el(
        'events',
        condition === undefined ? [] : [el('condition', [text(condition)])],
        present({
          names: events.join(', '),
          only: entity_ids?.join(', '),
        })
      )
    )
    .exhaustive();
}

function routineNode(context: RoutineContext): FxpNode {
  return el(
    'trigger',
    [
      note(
        `The routine ${context.name}, owned by ${context.owner.name}, fired. The prompt is what the routine asks you to do.`
      ),
      el(
        'routine',
        [],
        present({
          id: context.routine_id,
          name: context.name,
          ...personAttributes(context.owner, 'owner'),
        })
      ),
      el('instructions', [text(context.instructions)]),
      el('triggers', context.triggers.map(routineTriggerNode)),
      ...routineFiringNodes(context.firing),
    ],
    { kind: 'routine' }
  );
}

/** Why the agent was called, one renderer per kind. */
function triggerNode(trigger: TriggerContext): FxpNode {
  return match(trigger)
    .with({ kind: 'mentioned' }, mentionedNode)
    .with({ kind: 'follow_up' }, followUpNode)
    .with({ kind: 'task_assigned' }, taskAssignedNode)
    .with({ kind: 'requested' }, requestedNode)
    .with({ kind: 'dispatched' }, dispatchedNode)
    .with({ kind: 'routine' }, routineNode)
    .exhaustive();
}

/**
 * Name who the session acts for and who is asking. The agent runs with the
 * owner's access, so a prompt from anyone else must not be able to spend it
 * on things only the owner should see or do.
 */
function sessionNode(
  owner: AgentContextPerson,
  sender: AgentContextPerson | undefined
): FxpNode {
  const isOwner = sender?.id === owner.id;
  const prompter = sender?.name ?? 'A bot acting for nobody';
  const policy = isOwner
    ? `${owner.name} owns this session and sent this prompt.`
    : `${prompter} sent this prompt, but ${owner.name} owns this session. You act with the access of ${owner.name} - their email, calendar, documents, and connected apps. Every tool call that uses that access waits for ${owner.name} to approve it, so use the tools the request needs and let ${owner.name} decide. Do not refuse on ${owner.name}'s behalf: the approval request is how they say yes or no. Looking things up on the public web needs no approval. Do not repeat anything private to ${owner.name} that you saw in earlier turns. If a call is declined or not approved, say so and do not look for another way to do it.`;
  return el(
    'session',
    [
      el(
        'prompted_by',
        [],
        present({
          name: sender?.name,
          id: sender?.id,
          is_owner: isOwner ? 'true' : 'false',
        })
      ),
      note(policy),
    ],
    { owner: owner.name, owner_id: owner.id }
  );
}

/** Legacy conversation fields the input sets. */
export function legacyConversationFieldsIn(
  input: Partial<Record<(typeof LEGACY_CONVERSATION_FIELDS)[number], unknown>>
): (typeof LEGACY_CONVERSATION_FIELDS)[number][] {
  return LEGACY_CONVERSATION_FIELDS.filter(
    (field) => input[field] !== undefined
  );
}

function renderContext(input: AgentContextPrompt): string | undefined {
  const body = input.trigger
    ? triggerNode(input.trigger)
    : renderConversation(input);
  const nodes = [
    ...(input.owner ? [sessionNode(input.owner, input.sender)] : []),
    ...(body ? [body] : []),
  ];
  if (nodes.length === 0) return undefined;
  // The builder opens with a newline when formatting.
  return buildXml(nodes).trimStart();
}

function renderInstructions(
  instructions: string | undefined
): string | undefined {
  const trimmed = instructions?.trim();
  if (!trimmed) return undefined;
  return buildXml([el('instructions', [text(trimmed)])]).trimStart();
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
  const legacy = legacyConversationFieldsIn(input);
  if (input.trigger && legacy.length > 0) {
    throw new Error(
      `trigger cannot be combined with legacy conversation fields: ${legacy.join(', ')}`
    );
  }

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
      const sections = [
        renderInstructions(input.instructions),
        renderContext(input),
      ].filter((section) => section !== undefined);
      if (sections.length === 0) return;

      const context = $createAgentContextNode({
        version: 1,
        text: sections.join('\n'),
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
