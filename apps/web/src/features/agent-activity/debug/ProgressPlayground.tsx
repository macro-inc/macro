/**
 * Local playground for how an agent's reply reads while it works and once it
 * is done: every state as a channel message and as the agent session shows
 * it, side by side, from one set of fixture parts. Mounted at
 * `/app/debug/agent-progress`.
 *
 * Channel messages are composed by the server's own serializer, so each is
 * the markdown a thread would store; the session column renders the same
 * parts through the session's message renderer.
 */

import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { Message as AgentMessage } from '@app/features/block-agent/component/AgentMessage';
import { WorkingLine } from '@app/features/block-agent/ui/WorkingLine';
import { ChannelMessage } from '@channel/Message/ChannelMessage';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import type { MessageData } from '@core/messages/types';
import {
  type AgentChatReply,
  type AgentChatReplyBody,
  type AgentReplySegment,
  composeAgentChatReply,
} from '@macro-inc/lexical-core/utils/agent-chat-reply';
import type {
  ActivityRow,
  FoldedMessage,
  MessagePart,
  Segment,
  StopReason,
  ToolDetail,
  ToolName,
  ToolStatus,
  TurnPhase,
} from '@service-agent-fold/generated/types';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@theme/constants';
import { clearThemePreview, previewTheme } from '@theme/utils/themeUtils';
import { Button, Tabs } from '@ui';
import { createSignal, For, Index, type JSX, onCleanup, Show } from 'solid-js';
import { match, P } from 'ts-pattern';
import { LiveTail } from '../components/live-tail';
import { TypingRow } from '../components/typing-row';
import { streamingProse, typingLabel } from '../core/live-reply';

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

/** A reply at one moment, written once and shown in both surfaces. */
type Scenario = {
  id: string;
  title: string;
  /** What to look at. */
  note: string;
  parts: MessagePart[];
  /** The turn is still running. */
  inFlight: boolean;
  /** How a finished turn ended; `end_turn` unless set. */
  stop?: StopReason;
  /** The closing line the harness writes for a turn without an answer. */
  footer?: string;
};

/**
 * A session no backend knows: a live run fails to load it and keeps the
 * rows the message carries, as it does for a reader who cannot open it.
 */
const SESSION = '00000000-0000-4000-8000-00000000f01d';
const POSTED_AT = '2026-10-30T15:04:00.000Z';
const DOC_CHECKLIST = '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46';
const DOC_TIMELINE = '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e47';
const DOC_NOTES = '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e48';

// The harness's closing lines (agent_harness `channel_announcer`).
const CANCELLED_FALLBACK = 'I stopped before finishing that.';
const ERROR_FALLBACK = 'Sorry — I ran into an error while responding.';

function tool(
  id: string,
  name: string,
  detail: ToolDetail,
  status: ToolStatus = 'completed'
): ToolUsePart {
  return {
    kind: 'tool_use',
    id,
    name: { kind: 'native', name },
    status,
    detail,
  };
}

function macro(
  id: string,
  name: string,
  input: unknown,
  output: unknown,
  status: ToolStatus = 'completed',
  error: string | null = null
): ToolUsePart {
  return tool(id, name, { kind: 'macro', input, output, error }, status);
}

/** The call as it was before it finished: no result yet. */
function running(part: ToolUsePart): ToolUsePart {
  const detail = part.detail;
  if (detail.kind === 'macro')
    return { ...part, status: 'running', detail: { ...detail, output: null } };
  if (detail.kind === 'terminal')
    return {
      ...part,
      status: 'running',
      detail: { ...detail, output: null, exitCode: null },
    };
  return { ...part, status: 'running' };
}

const text = (value: string): MessagePart => ({ kind: 'text', text: value });

/** A document hit: in its text when given a snippet, else by name alone. */
function documentResult(id: string, name: string, snippet?: string) {
  return {
    type: 'document',
    id,
    name,
    owner_id: 'macro|ada@example.com',
    document_id: id,
    document_name: name,
    file_type: 'md',
    document_search_results: snippet
      ? [{ node_id: `${id}-hit`, highlight: { content: [snippet] } }]
      : [{ highlight: { name } }],
    metadata: {
      created_at: '2026-10-20T15:00:00.000Z',
      updated_at: '2026-10-28T15:00:00.000Z',
    },
  };
}

const SEARCH_DOCS = macro(
  'search-docs',
  'ContentSearch',
  { query: 'launch checklist' },
  {
    results: [
      documentResult(
        DOC_CHECKLIST,
        'Launch checklist',
        'Confirm the <macro_em>launch</macro_em> date with design'
      ),
      documentResult(
        DOC_TIMELINE,
        'Launch timeline',
        'Rollout starts Monday after the <macro_em>checklist</macro_em> clears'
      ),
      documentResult(
        DOC_NOTES,
        'Release notes',
        'Agent progress in channels, <macro_em>launch</macro_em> week'
      ),
    ],
  }
);
const SEARCH_NAMES = macro(
  'search-names',
  'NameSearch',
  { name: 'launch' },
  {
    results: [
      documentResult(DOC_CHECKLIST, 'Launch checklist'),
      documentResult(DOC_TIMELINE, 'Launch timeline'),
    ],
  }
);
const SEARCH_SKILLS = macro(
  'search-skills',
  'SearchSkills',
  { name: 'launch checklist' },
  {
    results: [
      { documentId: DOC_CHECKLIST, name: 'Launch checklist', updatedAt: null },
      { documentId: DOC_TIMELINE, name: 'Launch timeline', updatedAt: null },
      { documentId: DOC_NOTES, name: 'Release notes', updatedAt: null },
    ],
  }
);
const SEARCH_NOTHING = macro(
  'search-nothing',
  'NameSearch',
  { name: 'postmortem' },
  { results: [] }
);
const READ_DOC = macro(
  'read-doc',
  'ReadContent',
  { documentId: DOC_CHECKLIST },
  {
    content: {
      text: '# Launch checklist\n\n- [x] Release notes\n- [ ] Confirm the date\n- [ ] Tell support',
    },
    comments: [],
  }
);
const LIST_FAILED = macro(
  'list-entities',
  'ListEntities',
  { limit: 5 },
  'Failed to list entities: permission denied',
  'failed',
  'Failed to list entities: permission denied'
);
const WEB_SEARCH_FAILED = macro(
  'web-search',
  'WebSearch',
  { input: 'macro launch status' },
  {
    tool_use_id: 'web-search',
    content: {
      type: 'web_search_tool_result_error',
      error_code: 'unavailable',
    },
  }
);
const READ_FILE = tool('read-file', 'Read', {
  kind: 'read',
  paths: ['apps/web/src/features/agent-activity/agent-activity.tsx'],
});
const READ_FILES = tool('read-files', 'Read', {
  kind: 'read',
  paths: [
    'apps/web/src/features/agent-activity/components/activity-line.tsx',
    'apps/web/src/features/agent-activity/components/activity-rows.tsx',
    'apps/web/src/features/agent-activity/components/activity-summary.tsx',
  ],
});
const GREP = tool('grep', 'Grep', {
  kind: 'search',
  paths: ['apps/web/src'],
  output:
    'apps/web/src/features/agent-activity/agent-activity.tsx:4:import { ActivityLine }\napps/web/src/features/agent-activity/components/activity-line.tsx:20:export function ActivityLine(',
});
const SHELL = tool('shell', 'Bash', {
  kind: 'terminal',
  command: 'bun run check',
  output: 'Checked 1204 files in 3.1s\nNo problems found.',
  exitCode: 0,
});
const SHELL_FAILED = tool(
  'shell-failed',
  'Bash',
  {
    kind: 'terminal',
    command: 'bun run test src/features/agent-activity',
    output:
      'FAIL agent-activity.test.tsx > cycles through running steps\nAssertionError: expected "Reading" to be "Searching"',
    exitCode: 1,
  },
  'failed'
);
const EDIT = tool('edit', 'Edit', {
  kind: 'edit',
  diffs: [
    {
      path: 'docs/launch.md',
      oldText: '# Launch\n\n- [ ] Confirm the date\n',
      newText:
        '# Launch\n\n- [x] Confirm the date: Monday\n- [ ] Tell support\n',
    },
  ],
});
const FETCH_FAILED = tool(
  'fetch',
  'Fetch',
  {
    kind: 'fetch',
    output: 'Could not reach status.macro.com/api: connection refused.',
  },
  'failed'
);
const THINK = tool('think', 'Think', {
  kind: 'think',
  output: 'The date moved, so support needs a heads-up first.',
});
const SUBAGENT = tool('subagent', 'Agent', {
  kind: 'subagent',
  title: 'Verify the launch checklist',
  description: 'Verify the launch checklist',
  agentType: 'subagent',
  prompt: 'Check docs/launch.md against the release notes.',
  background: false,
  children: [],
  result: {
    text: 'The launch checklist matches the release notes.',
    error: null,
    agentId: 'verify-checklist',
    model: null,
    durationMs: 3485,
    tokens: null,
    toolUses: 2,
    stats: null,
  },
});
const PLAN: MessagePart = {
  kind: 'plan',
  entries: [
    { content: 'Find the checklist', priority: 'medium', status: 'completed' },
    { content: 'Confirm the date', priority: 'high', status: 'completed' },
    { content: 'Tell support', priority: 'medium', status: 'pending' },
  ],
};
const THOUGHT: MessagePart = {
  kind: 'thought',
  text: 'The checklist is the source of truth; the timeline may be stale.',
};

const ANSWER =
  'The <m-document-mention>{"documentId":"4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46","documentName":"Launch checklist","blockName":"md"}</m-document-mention> has two open items: confirming the date and telling support. <m-user-mention>{"userId":"macro|ada@example.com","email":"ada@example.com","displayName":"Ada"}</m-user-mention> owns the date.';

const LONG_QUERY =
  'launch checklist for the agent progress line in channels and agent sessions, including the collapsed summary and every expanded row';

const SCENARIOS: Scenario[] = [
  {
    id: 'thinking',
    title: 'Before the first step',
    note: 'A thread reply shows the Thinking spinner; a DM posts nothing yet, only the typing row.',
    parts: [],
    inFlight: true,
  },
  {
    id: 'one-running',
    title: 'One step running',
    note: 'One shimmering line with the working dots.',
    parts: [running(SEARCH_DOCS)],
    inFlight: true,
  },
  {
    id: 'parallel',
    title: 'Steps running at once',
    note: 'The channel line takes turns between them every 2s.',
    parts: [running(READ_DOC), running(SEARCH_SKILLS), running(GREP)],
    inFlight: true,
  },
  {
    id: 'after-prose',
    title: 'A passage, then working',
    note: 'A finished passage is part of the message; the open run follows it.',
    parts: [
      text('Looking into the launch checklist first.'),
      SEARCH_DOCS,
      running(READ_DOC),
    ],
    inFlight: true,
  },
  {
    id: 'held',
    title: 'Run sealed while a call is held',
    note: 'A later passage sealed the run, but one call still runs: the summary shimmers.',
    parts: [
      SEARCH_DOCS,
      running(READ_DOC),
      text('While that loads: the timeline says Monday.'),
    ],
    inFlight: true,
  },
  {
    id: 'streaming',
    title: 'Steps done, answer streaming',
    note: 'The run folds; the passage being written streams in the typing row.',
    parts: [SEARCH_DOCS, READ_DOC, text(ANSWER)],
    inFlight: true,
  },
  {
    id: 'answered',
    title: 'Answered',
    note: 'A sealed run as "Used N tools"; mentions in the accent color.',
    parts: [SEARCH_DOCS, READ_DOC, text(ANSWER)],
    inFlight: false,
  },
  {
    id: 'single',
    title: 'One tool',
    note: 'Singular summary.',
    parts: [SEARCH_SKILLS, text('Found three skills that match.')],
    inFlight: false,
  },
  {
    id: 'interleaved',
    title: 'Passages between runs',
    note: 'Each run folds on its own, between the passages around it.',
    parts: [
      text('Starting with the checklist.'),
      THOUGHT,
      SEARCH_SKILLS,
      READ_DOC,
      text('The date moved. Updating the doc and checking it builds.'),
      GREP,
      EDIT,
      SHELL,
      text(ANSWER),
    ],
    inFlight: false,
  },
  {
    id: 'failures',
    title: 'Some steps failed',
    note: 'Failures are counted on the summary and marked on their rows.',
    parts: [
      SEARCH_DOCS,
      LIST_FAILED,
      WEB_SEARCH_FAILED,
      SHELL_FAILED,
      FETCH_FAILED,
      text(
        'Two sources were unreachable, so this is from the checklist alone.'
      ),
    ],
    inFlight: false,
  },
  {
    id: 'stopped',
    title: 'Stopped mid-run',
    note: 'Calls still running when the turn ended read as interrupted.',
    parts: [SEARCH_DOCS, running(READ_DOC), running(SHELL)],
    inFlight: false,
    stop: { kind: 'cancelled' },
    footer: CANCELLED_FALLBACK,
  },
  {
    id: 'errored',
    title: 'Turn failed',
    note: 'The runtime failed the prompt after one step.',
    parts: [SEARCH_DOCS],
    inFlight: false,
    stop: { kind: 'failed', message: 'Upstream model overloaded' },
    footer: ERROR_FALLBACK,
  },
  {
    id: 'no-results',
    title: 'Search with no results',
    note: 'A count of zero and nothing to open.',
    parts: [SEARCH_NOTHING, text('Nothing matches "postmortem" yet.')],
    inFlight: false,
  },
  {
    id: 'long',
    title: 'Long details',
    note: 'Queries and paths truncate on one line, running and done.',
    parts: [
      macro(
        'long-search',
        'ContentSearch',
        { query: LONG_QUERY },
        { results: [] }
      ),
      running(
        tool('long-read', 'Read', {
          kind: 'read',
          paths: [
            'apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/MagicChip/presentation/very-long-file-name.tsx',
          ],
        })
      ),
    ],
    inFlight: true,
  },
  {
    id: 'every-tool',
    title: 'Every kind of step',
    note: 'One of each, done: Macro tools, files, shell, edits, plan, subagent.',
    parts: [
      SEARCH_DOCS,
      SEARCH_NAMES,
      SEARCH_SKILLS,
      READ_DOC,
      READ_FILE,
      READ_FILES,
      GREP,
      SHELL,
      EDIT,
      THINK,
      PLAN,
      SUBAGENT,
      LIST_FAILED,
      FETCH_FAILED,
      text('Done.'),
    ],
    inFlight: false,
  },
];

/** A turn from first step to answer, one frame every few seconds. */
const REPLAY: { parts: MessagePart[]; inFlight: boolean }[] = [
  { parts: [], inFlight: true },
  { parts: [running(SEARCH_DOCS)], inFlight: true },
  {
    parts: [SEARCH_DOCS, running(READ_DOC), running(SEARCH_SKILLS)],
    inFlight: true,
  },
  {
    parts: [SEARCH_DOCS, READ_DOC, SEARCH_SKILLS, running(GREP)],
    inFlight: true,
  },
  {
    parts: [SEARCH_DOCS, READ_DOC, SEARCH_SKILLS, GREP, running(SHELL)],
    inFlight: true,
  },
  {
    parts: [SEARCH_DOCS, READ_DOC, SEARCH_SKILLS, GREP, SHELL, text(ANSWER)],
    inFlight: true,
  },
  {
    parts: [SEARCH_DOCS, READ_DOC, SEARCH_SKILLS, GREP, SHELL, text(ANSWER)],
    inFlight: false,
  },
];
const REPLAY_FRAME_MS = 2500;

// What follows mirrors agent_fold's `segment.rs`, so the channel reads its
// steps as the server words them.

const DETAIL_MAX_CHARS = 80;

/** A step's verbs while it runs, once done, and if it failed. */
const VERBS: Partial<
  Record<ToolDetail['kind'], readonly [string, string, string]>
> = {
  terminal: ['Running', 'Ran', 'Command failed'],
  edit: ['Editing', 'Edited', 'Edit failed'],
  read: ['Reading', 'Read', 'Read failed'],
  delete: ['Deleting', 'Deleted', 'Delete failed'],
  move: ['Moving', 'Moved', 'Move failed'],
  search: ['Searching', 'Searched', 'Search failed'],
  fetch: ['Fetching', 'Fetched', 'Fetch failed'],
  subagent: ['Delegating', 'Delegated', 'Delegation failed'],
};
const INPUT_DETAIL_KEYS = [
  'query',
  'q',
  'title',
  'name',
  'documentName',
  'fileName',
  'url',
  'path',
  'subject',
];

function truncate(value: string): string {
  const line = (value.split('\n')[0] ?? '').trim();
  const characters = [...line];
  if (characters.length <= DETAIL_MAX_CHARS) return line;
  return `${characters
    .slice(0, DETAIL_MAX_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

function pathsDetail(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length > 1) return `${paths.length} files`;
  return truncate(paths[0]!.split('/').at(-1) ?? paths[0]!);
}

function inputDetail(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  for (const key of INPUT_DETAIL_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return truncate(value);
  }
  return null;
}

/** `ListEntities` reads `List entities`; acronyms stay as written. */
function humanize(name: string): string {
  const words = name
    .split(/[_\-. ]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter(Boolean)
    .map((word) =>
      word.length > 1 && /^[A-Z0-9]+$/.test(word) ? word : word.toLowerCase()
    );
  const sentence = words.join(' ');
  return sentence ? sentence[0]!.toUpperCase() + sentence.slice(1) : 'Tool';
}

function toolName(name: ToolName): string {
  return name.kind === 'native' ? name.name : name.tool;
}

function verbDetail(detail: ToolDetail): string | null {
  return match(detail)
    .with({ kind: 'terminal' }, ({ command }) =>
      command ? truncate(command) : null
    )
    .with({ kind: 'edit' }, ({ diffs }) =>
      pathsDetail(diffs.map((diff) => diff.path))
    )
    .with({ kind: P.union('read', 'delete', 'move', 'search') }, ({ paths }) =>
      pathsDetail(paths)
    )
    .with({ kind: 'subagent' }, ({ title }) => truncate(title))
    .otherwise(() => null);
}

function stepRow(part: ToolUsePart, closed: boolean): ActivityRow {
  const status: ActivityRow['status'] =
    part.status === 'completed'
      ? 'completed'
      : part.status === 'failed'
        ? 'failed'
        : closed
          ? 'interrupted'
          : 'running';
  const verbs = VERBS[part.detail.kind];
  if (verbs) {
    const [whileRunning, done, failed] = verbs;
    const label =
      status === 'running' ? whileRunning : status === 'failed' ? failed : done;
    return { id: part.id, label, detail: verbDetail(part.detail), status };
  }
  if (part.detail.kind === 'think')
    return { id: part.id, label: 'Thought it through', detail: null, status };
  const named = humanize(toolName(part.name));
  const input =
    part.detail.kind === 'macro' || part.detail.kind === 'other'
      ? part.detail.input
      : undefined;
  return {
    id: part.id,
    label: status === 'failed' ? `${named} failed` : named,
    detail: inputDetail(input),
    status,
  };
}

function activityRows(
  parts: readonly MessagePart[],
  closed: boolean
): ActivityRow[] {
  return parts.flatMap((part): ActivityRow[] => {
    if (part.kind === 'tool_use') return [stepRow(part, closed)];
    if (part.kind !== 'plan') return [];
    const done = part.entries.filter(
      (entry) => entry.status === 'completed'
    ).length;
    return [
      {
        id: 'plan',
        label: 'Updated the plan',
        detail: `${done}/${part.entries.length} done`,
        status: 'completed',
      },
    ];
  });
}

function segmentKind(part: MessagePart): Segment['kind'] | undefined {
  if (part.kind === 'text') return part.text.trim() ? 'prose' : undefined;
  if (part.kind === 'tool_use' || part.kind === 'plan') return 'activity';
  return undefined;
}

function segmentsOf(parts: readonly MessagePart[], inFlight: boolean) {
  const segments: Segment[] = [];
  parts.forEach((part, index) => {
    const kind = segmentKind(part);
    if (!kind) return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.end = index + 1;
    else
      segments.push({
        index: segments.length,
        kind,
        start: index,
        end: index + 1,
        sealed: true,
        rows: [],
      });
  });
  return segments.map((segment, index) => ({
    ...segment,
    sealed: !inFlight || index < segments.length - 1,
    rows:
      segment.kind === 'activity'
        ? activityRows(parts.slice(segment.start, segment.end), !inFlight)
        : [],
  }));
}

function phaseOf(parts: readonly MessagePart[]): TurnPhase {
  const last = parts.at(-1);
  if (!last) return 'thinking';
  return last.kind === 'text' ? 'writing' : 'working';
}

function foldedReply(scenario: Scenario): FoldedMessage {
  return {
    agentSessionId: SESSION,
    turn: 1,
    author: { kind: 'agent' },
    requestId: null,
    parts: scenario.parts,
    stop: scenario.inFlight ? null : (scenario.stop ?? { kind: 'end_turn' }),
    pending: false,
    segments: segmentsOf(scenario.parts, scenario.inFlight),
    phase: scenario.inFlight ? phaseOf(scenario.parts) : null,
    postedAt: null,
  };
}

/**
 * A passage or a run of steps as a posted message stores it. Stored rows
 * never carry details, which only a reader of the live session sees.
 */
function storedSegment(
  scenario: Scenario,
  segment: Segment,
  reader: boolean
): AgentReplySegment | undefined {
  const parts = scenario.parts.slice(segment.start, segment.end);
  if (segment.kind === 'prose') {
    // An unfinished passage is not posted; it streams in the typing row.
    if (!segment.sealed) return undefined;
    const markdown = parts
      .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
      .join('\n\n');
    return { kind: 'prose', markdown };
  }
  if (segment.kind !== 'activity') return undefined;
  return {
    kind: 'activity',
    turn: 1,
    segment: segment.index,
    sealed: segment.sealed,
    rows: segment.rows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      ...(reader && !segment.sealed && row.detail
        ? { detail: row.detail }
        : {}),
    })),
  };
}

/**
 * The messages a reply posts (agent_harness `present.rs`). A thread reply is
 * one message that leads with the session link and shows the spinner while
 * the turn runs. A DM posts a message per finished passage with the steps
 * after it attached, and nothing until there is something to show.
 */
function replyMessages(
  scenario: Scenario,
  conversation: Conversation,
  reader: boolean
): AgentChatReply[] {
  const stored = segmentsOf(scenario.parts, scenario.inFlight).flatMap(
    (segment) => storedSegment(scenario, segment, reader) ?? []
  );
  if (conversation === 'thread') {
    const body: AgentChatReplyBody =
      stored.length > 0
        ? {
            kind: 'segments',
            segments: stored,
            pending: scenario.inFlight,
            footer: scenario.footer,
          }
        : scenario.inFlight
          ? { kind: 'pending' }
          : { kind: 'markdown', markdown: scenario.footer ?? '' };
    return [{ sessionId: SESSION, link: true, body }];
  }
  const messages: AgentReplySegment[][] = [];
  for (const segment of stored) {
    const last = messages.at(-1);
    if (segment.kind === 'prose' || !last) messages.push([segment]);
    else last.push(segment);
  }
  if (messages.length === 0) {
    return scenario.footer && !scenario.inFlight
      ? [
          {
            sessionId: SESSION,
            link: false,
            body: { kind: 'markdown', markdown: scenario.footer },
          },
        ]
      : [];
  }
  return messages.map((segments, index) => ({
    sessionId: SESSION,
    link: false,
    body: {
      kind: 'segments',
      segments,
      footer:
        !scenario.inFlight && index === messages.length - 1
          ? scenario.footer
          : undefined,
    },
  }));
}

function channelMessage(reply: AgentChatReply, id: string): MessageData {
  return {
    id,
    content: composeAgentChatReply(reply),
    sender_id: `bot|${MACRO_AGENT_BOT_ID}`,
    sender: {
      id: MACRO_AGENT_BOT_ID,
      type: 'bot',
      name: 'Macro',
      avatar_url: null,
    },
    created_at: POSTED_AT,
    updated_at: POSTED_AT,
    attachments: [],
    reactions: [],
  };
}

type Theme = 'app' | 'light' | 'dark';
type Viewer = 'reader' | 'member';
type Width = 'wide' | 'phone';
type Conversation = 'thread' | 'dm';

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div class="flex items-center gap-2">
      <span class="text-ink-extra-muted">{props.label}</span>
      <Tabs
        aria-label={props.label}
        size="sm"
        options={props.options}
        value={props.value}
        onChange={props.onChange}
      />
    </div>
  );
}

function Surface(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge-muted bg-panel">
      <div class="border-b border-edge-muted px-3 py-1.5 text-xs text-ink-extra-muted">
        {props.label}
      </div>
      <div class="min-w-0 py-2">{props.children}</div>
    </div>
  );
}

/** The conversation: the reply's messages, and the typing row while it runs. */
function ChannelColumn(props: {
  scenario: Scenario;
  conversation: Conversation;
  reader: boolean;
}) {
  const reply = () => foldedReply(props.scenario);
  const messages = () =>
    replyMessages(props.scenario, props.conversation, props.reader).map(
      (message, index) =>
        channelMessage(message, `playground-${props.scenario.id}-${index}`)
    );
  return (
    <>
      {/* By position, as the server reuses a reply's n-th message. */}
      <Index each={messages()}>
        {(message, index) => (
          <ChannelMessage
            message={message()}
            listMeta={{
              index,
              isNewMessage: false,
              isFirstNewMessage: false,
              isGroupedWithPrevious: index > 0,
            }}
            hideTriggeredBy
          />
        )}
      </Index>
      <Show when={props.scenario.inFlight}>
        <TypingRow
          avatar={
            <PersonaAvatar botId={MACRO_AGENT_BOT_ID} name="Macro" size="sm" />
          }
          label={typingLabel('Macro', phaseOf(props.scenario.parts))}
        >
          <Show when={props.reader}>
            <LiveTail prose={streamingProse(reply())} onStop={() => {}} />
          </Show>
        </TypingRow>
      </Show>
    </>
  );
}

/** The session: the reply, or its working line before it has any parts. */
function SessionColumn(props: { scenario: Scenario }) {
  return (
    <div class="px-4 pb-2">
      <Show
        when={props.scenario.parts.length > 0}
        fallback={<WorkingLine label="Working" />}
      >
        <AgentMessage
          message={foldedReply(props.scenario)}
          inFlight={props.scenario.inFlight}
        />
      </Show>
    </div>
  );
}

function ScenarioRow(props: {
  scenario: Scenario;
  conversation: Conversation;
  reader: boolean;
  phone: boolean;
  controls?: JSX.Element;
}) {
  return (
    <section
      id={props.scenario.id}
      class="flex scroll-mt-16 flex-col gap-3 border-t border-edge-muted py-6"
      data-scenario={props.scenario.id}
    >
      <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="text-sm font-medium text-ink">{props.scenario.title}</h2>
        <p class="text-xs text-ink-muted">{props.scenario.note}</p>
        {props.controls}
      </header>
      <div
        class="grid gap-4"
        classList={{
          'grid-cols-[repeat(2,390px)]': props.phone,
          'grid-cols-1 xl:grid-cols-2': !props.phone,
        }}
      >
        <Surface label={props.conversation === 'thread' ? 'Thread' : 'DM'}>
          <ChannelColumn
            scenario={props.scenario}
            conversation={props.conversation}
            reader={props.reader}
          />
        </Surface>
        <Surface label="Agent session">
          <SessionColumn scenario={props.scenario} />
        </Surface>
      </div>
    </section>
  );
}

function ReplayRow(props: {
  conversation: Conversation;
  reader: boolean;
  phone: boolean;
}) {
  const [frame, setFrame] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const timer = setInterval(() => {
    if (playing()) setFrame((index) => (index + 1) % REPLAY.length);
  }, REPLAY_FRAME_MS);
  onCleanup(() => clearInterval(timer));
  const scenario = (): Scenario => ({
    id: 'replay',
    title: 'Live replay',
    note: `Frame ${frame() + 1} of ${REPLAY.length}: first step to answer, ${REPLAY_FRAME_MS / 1000}s a frame.`,
    ...REPLAY[frame()]!,
  });
  return (
    <ScenarioRow
      scenario={scenario()}
      conversation={props.conversation}
      reader={props.reader}
      phone={props.phone}
      controls={
        <div class="flex items-center gap-2 text-xs">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPlaying(!playing())}
          >
            {playing() ? 'Pause' : 'Play'}
          </Button>
          <input
            type="range"
            min={0}
            max={REPLAY.length - 1}
            value={frame()}
            aria-label="Replay frame"
            onInput={(event) => {
              setPlaying(false);
              setFrame(event.currentTarget.valueAsNumber);
            }}
          />
        </div>
      }
    />
  );
}

/**
 * Opens (or closes) every disclosure on the page, a few passes deep: a
 * group's rows only exist once the group is open.
 */
function toggleAll(root: HTMLElement | undefined, open: boolean) {
  let pass = 0;
  const step = () => {
    const toggles = root?.querySelectorAll<HTMLElement>(
      `button[aria-expanded="${open ? 'false' : 'true'}"]`
    );
    if (!toggles?.length) return;
    // Closing from the outside in hides the inner toggles with their group.
    for (const toggle of open ? toggles : [...toggles].reverse())
      toggle.click();
    if (++pass < 4) requestAnimationFrame(step);
  };
  step();
}

export default function ProgressPlayground() {
  const [theme, setTheme] = createSignal<Theme>('app');
  const [viewer, setViewer] = createSignal<Viewer>('reader');
  const [width, setWidth] = createSignal<Width>('wide');
  const [conversation, setConversation] = createSignal<Conversation>('thread');
  const phone = () => width() === 'phone';
  let scenarios: HTMLDivElement | undefined;

  const applyPreview = (next: Theme) => {
    setTheme(next);
    if (next === 'app') clearThemePreview();
    else
      previewTheme(next === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME);
  };
  onCleanup(() => clearThemePreview());

  return (
    <div class="size-full overflow-auto bg-surface text-ink">
      <div class="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-edge-muted bg-surface px-6 py-2 text-xs">
        <span class="font-medium text-ink">Agent progress</span>
        <Choice
          label="Theme"
          value={theme()}
          options={[
            { value: 'app', label: 'App' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={applyPreview}
        />
        <Choice
          label="Conversation"
          value={conversation()}
          options={[
            { value: 'thread', label: 'Thread' },
            { value: 'dm', label: 'DM' },
          ]}
          onChange={setConversation}
        />
        <Choice
          label="Viewer"
          value={viewer()}
          options={[
            { value: 'reader', label: 'Can open session' },
            { value: 'member', label: "Can't open session" },
          ]}
          onChange={setViewer}
        />
        <Choice
          label="Width"
          value={width()}
          options={[
            { value: 'wide', label: 'Wide' },
            { value: 'phone', label: 'Phone' },
          ]}
          onChange={setWidth}
        />
        <div class="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleAll(scenarios, true)}
          >
            Expand all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleAll(scenarios, false)}
          >
            Collapse all
          </Button>
        </div>
        <nav class="flex flex-wrap gap-x-2 text-ink-extra-muted">
          <a class="hover:text-ink" href="#replay">
            Replay
          </a>
          <For each={SCENARIOS}>
            {(scenario) => (
              <a class="hover:text-ink" href={`#${scenario.id}`}>
                {scenario.title}
              </a>
            )}
          </For>
        </nav>
      </div>
      <div ref={scenarios} class="px-6 pb-16">
        <ReplayRow
          conversation={conversation()}
          reader={viewer() === 'reader'}
          phone={phone()}
        />
        <For each={SCENARIOS}>
          {(scenario) => (
            <ScenarioRow
              scenario={scenario}
              conversation={conversation()}
              reader={viewer() === 'reader'}
              phone={phone()}
            />
          )}
        </For>
      </div>
    </div>
  );
}
