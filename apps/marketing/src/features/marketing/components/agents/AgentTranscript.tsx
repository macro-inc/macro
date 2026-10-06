import CaretRight from '@phosphor/caret-right.svg';
import Envelope from '@phosphor/envelope.svg';
import EnvelopeOpen from '@phosphor/envelope-open.svg';
import Eye from '@phosphor/eye.svg';
import File from '@phosphor/file.svg';
import HashStraight from '@phosphor/hash-straight.svg';
import ListChecks from '@phosphor/list-checks.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Newspaper from '@phosphor/newspaper.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import { Button, UserMessageBubble } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { TaskPriority, TaskStatus } from '../../core/dummy-workspace';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { PropertyValueIcon } from '../workspace/frozen/PropertyValueIcon';
import {
  PersonIcon,
  PRIORITY_IDS,
  STATUS_IDS,
} from '../workspace/frozen/TaskProperties';
import '../demo-markdown.css';
import '../demo-mentions.css';
import './agent-transcript.css';

/**
 * Frozen presentation of a Macro agent session (block-agent's Message,
 * ToolGroup, Thought, and the chat block's grouped tool renderers). Website
 * fixtures only: no sessions, tools, providers, or network.
 */

type Icon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export type SearchHit = {
  kind: 'email' | 'document' | 'channel' | 'call' | 'task';
  title: string;
  sender?: string;
  snippet: string;
  time: string;
};

export type AgentToolCall =
  | { kind: 'thought'; text: string }
  | { kind: 'search'; query: string; hits: SearchHit[] }
  | { kind: 'read-channel'; channel: string; count: number }
  | { kind: 'read-call' }
  | { kind: 'read-document'; title: string }
  | { kind: 'read-thread' };

export type AgentMention = {
  kind: 'person' | 'task' | 'email' | 'document' | 'channel' | 'call';
  person?: HomepagePersonId;
  /** A call mention shows its start time beside the name. */
  time?: string;
  task?: {
    status: TaskStatus;
    priority: TaskPriority;
    owner: HomepagePersonId;
  };
  onOpen?: () => void;
};

const HIT_ICONS: Record<SearchHit['kind'], Icon> = {
  email: Envelope,
  document: File,
  channel: HashStraight,
  call: PhoneCall,
  task: ListChecks,
};

const MENTION_ICONS: Record<
  Exclude<AgentMention['kind'], 'person' | 'task'>,
  Icon
> = {
  email: Envelope,
  document: File,
  channel: HashStraight,
  call: PhoneCall,
};

/** The "Thinking"/"Calling" sweep; plain text once the work settles. */
function Shimmer(props: { text: string; active?: boolean }) {
  return (
    <span classList={{ 'magic-chip-shimmer': !!props.active }}>
      {props.text}
    </span>
  );
}

/** A prompt in the chat block's user bubble. */
export function AgentPrompt(props: { text: string }) {
  return (
    <div class="flex w-full flex-col items-end gap-0.5">
      <UserMessageBubble>
        <div class="chat-markdown-container whitespace-pre-wrap wrap-break-word max-w-full text-base">
          {props.text}
        </div>
      </UserMessageBubble>
    </div>
  );
}

/** block-agent's Thought: a bare caret row that opens to the reasoning. */
export function AgentThought(props: { text: string; active?: boolean }) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded(!expanded())}
      >
        <CaretRight
          class={`size-4 shrink-0 ${expanded() ? 'rotate-90' : ''}`}
        />
        <Shimmer
          text={props.active ? 'Thinking' : 'Thought'}
          active={props.active}
        />
      </button>
      <Show when={expanded()}>
        <div class="pl-5 text-ink-muted whitespace-pre-wrap wrap-break-word select-text">
          {props.text}
        </div>
      </Show>
    </div>
  );
}

/** Tool.Row in its grouped form: no surface, one 32px line. */
function ToolRow(props: {
  icon: Icon;
  align?: 'start';
  children: JSX.Element;
  response?: JSX.Element;
}) {
  return (
    <div
      class="relative overflow-hidden text-xs leading-5 text-ink-extra-muted"
      data-tool-row
    >
      <div
        class={`flex w-full gap-2 min-h-8 py-1 text-sm leading-6 ${props.align === 'start' ? 'items-start' : 'items-center'}`}
      >
        <Dynamic
          component={props.icon}
          class={`size-4 shrink-0 text-ink-extra-muted ${props.align === 'start' ? 'mt-0.5' : ''}`}
        />
        <div class="min-w-0 flex-1 overflow-hidden">{props.children}</div>
      </div>
      <Show when={props.response}>
        <div class="px-3 pb-2">{props.response}</div>
      </Show>
    </div>
  );
}

/** Search.tsx: scope in the row, "N hits" toggles the matched items. */
function SearchRow(props: {
  call: Extract<AgentToolCall, { kind: 'search' }>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = createSignal(false);
  const open = () => props.open ?? inner();
  const toggle = () => {
    setInner(!open());
    props.onOpenChange?.(!open());
  };
  const count = () => props.call.hits.length;
  return (
    <ToolRow
      icon={MagnifyingGlass}
      response={
        <Show when={open()}>
          <div class="max-h-120 overflow-y-auto">
            <div class="-mx-3 -my-2">
              <For each={props.call.hits}>
                {(hit) => (
                  <button
                    type="button"
                    class="block w-full text-left hover:bg-hover"
                    data-search-hit={hit.kind}
                  >
                    <div class="flex min-h-8 items-center gap-2 px-3 py-1.5 text-xs leading-4">
                      <div
                        class="flex size-4 shrink-0 items-center justify-center"
                        classList={{
                          'text-note': hit.kind === 'document',
                          'text-task': hit.kind === 'task',
                          'text-default':
                            hit.kind !== 'document' && hit.kind !== 'task',
                        }}
                      >
                        <Dynamic
                          component={HIT_ICONS[hit.kind]}
                          class="size-4"
                        />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <div class="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden">
                            <span class="min-w-0 max-w-40 shrink-0 truncate text-ink">
                              {hit.title}
                            </span>
                            <span class="text-ink-placeholder">·</span>
                            <Show when={hit.sender}>
                              <span class="shrink-0 text-ink-placeholder">
                                {hit.sender}
                              </span>
                            </Show>
                            <span class="min-w-0 flex-1 truncate text-ink-placeholder">
                              {hit.snippet}
                            </span>
                          </div>
                          <span class="shrink-0 text-ink-placeholder">
                            {hit.time}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
        <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <span class="min-w-0 truncate">
            Search <span class="text-ink"> {props.call.query} </span>
          </span>
        </div>
        <Button
          type="button"
          variant="plain"
          size="sm"
          noTouchResize
          aria-expanded={open()}
          class="shrink-0 whitespace-nowrap px-1 text-ink-extra-muted hover:text-ink-muted"
          data-search-toggle
          onClick={toggle}
        >
          <span>{count() === 1 ? '1 hit' : `${count()} hits`}</span>
          <CaretRight aria-hidden="true" class={open() ? 'rotate-90' : ''} />
        </Button>
      </div>
    </ToolRow>
  );
}

function ToolCallRow(props: {
  call: AgentToolCall;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}) {
  return (
    <Switch>
      <Match when={props.call.kind === 'thought' && props.call}>
        {(call) => <AgentThought text={call().text} />}
      </Match>
      <Match when={props.call.kind === 'search' && props.call}>
        {(call) => (
          <SearchRow
            call={call()}
            open={props.searchOpen}
            onOpenChange={props.onSearchOpenChange}
          />
        )}
      </Match>
      <Match when={props.call.kind === 'read-channel' && props.call}>
        {(call) => (
          <ToolRow icon={Eye} align="start">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex min-w-0 items-center justify-between gap-3 overflow-hidden">
                <span class="min-w-0 truncate">
                  Read messages in{' '}
                  <span class="text-ink">{call().channel}</span>
                </span>
                <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
                  {call().count} messages
                </span>
              </div>
              <div class="truncate text-xs text-ink-placeholder">latest</div>
            </div>
          </ToolRow>
        )}
      </Match>
      <Match when={props.call.kind === 'read-call'}>
        <ToolRow icon={Newspaper}>
          Read <span class="text-ink">call transcript</span>
        </ToolRow>
      </Match>
      <Match when={props.call.kind === 'read-document' && props.call}>
        {(call) => (
          <ToolRow icon={Newspaper}>
            <div class="min-w-0 flex-1 truncate">
              Read <span class="text-ink">document</span>{' '}
              <span class="text-ink-placeholder">·</span>{' '}
              <span class="inline-flex items-center gap-1 align-middle text-ink">
                <File class="size-4 text-note" />
                {call().title}
              </span>
            </div>
          </ToolRow>
        )}
      </Match>
      <Match when={props.call.kind === 'read-thread'}>
        <ToolRow icon={EnvelopeOpen}>Read thread</ToolRow>
      </Match>
    </Switch>
  );
}

/**
 * block-agent's ToolGroup: "Calling N tools" shimmers while a call is in
 * flight, "Called N tools" once the run settles, and opens to the calls.
 */
export function AgentToolGroup(props: {
  calls: AgentToolCall[];
  active?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = createSignal(props.defaultOpen ?? false);
  const open = () => props.open ?? inner();
  const count = () =>
    props.calls.filter((call) => call.kind !== 'thought').length;
  const title = () =>
    `${props.active ? 'Calling' : 'Called'} ${count()} ${count() === 1 ? 'tool' : 'tools'}`;
  return (
    <div class="min-w-0 text-sm leading-6 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={open()}
        class="group flex min-h-8 items-center gap-2 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        data-tool-group
        onClick={() => {
          setInner(!open());
          props.onOpenChange?.(!open());
        }}
      >
        <Shimmer text={title()} active={props.active} />
        <CaretRight
          aria-hidden="true"
          class={`size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none ${open() ? 'rotate-90' : ''}`}
        />
      </button>
      <Show when={open()}>
        <div role="region" aria-label="Tool calls">
          <div class="flex min-w-0 flex-col pl-6">
            <For each={props.calls}>
              {(call) => (
                <div class="min-h-8 shrink-0 agent-tool-enter">
                  <ToolCallRow
                    call={call}
                    searchOpen={props.searchOpen}
                    onSearchOpenChange={props.onSearchOpenChange}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** ActionLine: a model switch reads as punctuation between turns. */
export function AgentActionLine(props: { label: string }) {
  return (
    <div class="flex w-full items-center gap-4 px-4 py-1 text-xs text-ink-extra-muted">
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="min-w-0 truncate">{props.label}</span>
      </span>
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
    </div>
  );
}

/** DocumentMention's MentionContainer (icon + underlined name) and UserMention. */
function MentionChip(props: { label: string; mention?: AgentMention }) {
  const mention = () => props.mention;
  const content = () => {
    const value = mention();
    if (!value) return props.label;
    if (value.kind === 'person' && value.person)
      return `@${homepagePeople[value.person].shortName}`;
    return (
      <>
        <span
          aria-hidden="true"
          class={`demo-mention-icon mention-${value.kind}`}
        >
          <Dynamic
            component={
              value.kind === 'task'
                ? ListChecks
                : MENTION_ICONS[value.kind as keyof typeof MENTION_ICONS]
            }
          />
        </span>
        <span class="demo-mention-name">
          {props.label}
          <Show when={value.time}>
            <span class="agent-mention-time"> {value.time}</span>
          </Show>
          <Show when={value.task}>
            {(task) => (
              <span class="agent-mention-task" aria-hidden="true">
                <PropertyValueIcon
                  optionId={STATUS_IDS[task().status]}
                  class="size-3"
                />
                <PropertyValueIcon
                  optionId={PRIORITY_IDS[task().priority]}
                  class="size-3"
                />
                <span class="agent-mention-avatar">
                  <PersonIcon person={task().owner} />
                </span>
              </span>
            )}
          </Show>
        </span>
      </>
    );
  };
  return (
    <Show
      when={mention()?.onOpen}
      fallback={
        <span
          class={`demo-inline-mention agent-mention mention-${mention()?.kind ?? 'document'}`}
          data-agent-mention={mention()?.kind}
        >
          {content()}
        </span>
      }
    >
      {(open) => (
        <button
          type="button"
          class={`demo-inline-mention agent-mention mention-${mention()?.kind}`}
          data-agent-mention={mention()?.kind}
          onClick={() => open()()}
        >
          {content()}
        </button>
      )}
    </Show>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|@\[[^\]]*\]\(agent:[\w-]+\))/g;

function Inline(props: {
  text: string;
  mentions: Record<string, AgentMention>;
}) {
  return (
    <For each={props.text.split(TOKEN)}>
      {(part) => {
        const mention = /^@\[([^\]]*)\]\(agent:([\w-]+)\)$/.exec(part);
        if (mention)
          return (
            <MentionChip
              label={mention[1]}
              mention={props.mentions[mention[2]]}
            />
          );
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return <strong class="font-bold">{part.slice(2, -2)}</strong>;
        return part;
      }}
    </For>
  );
}

/**
 * The agent's reply as StaticMarkdown renders it in a session: paragraphs,
 * bullet lists, bold, and inline mentions that open their item.
 */
export function AgentAnswer(props: {
  text: string;
  mentions: Record<string, AgentMention>;
}) {
  return (
    <div class="agent-answer chat-markdown-container whitespace-pre-wrap wrap-break-word max-w-full text-base">
      <div class="website-demo-markdown md max-w-full min-w-0 channel-markdown">
        <For each={props.text.split(/\n\s*\n/).filter(Boolean)}>
          {(block) => (
            <Show
              when={block.startsWith('- ')}
              fallback={
                <p class="my-4 first:mt-1.5 last:mb-1.5 md-p text-[1em] whitespace-pre-wrap">
                  <Inline text={block} mentions={props.mentions} />
                </p>
              }
            >
              <ul class="my-4 first:mt-1.5 last:mb-1.5 list-none md-list md-bullet">
                <For each={block.split('\n')}>
                  {(line) => (
                    <li class="my-[0.25em]">
                      <Inline
                        text={line.replace(/^- /, '')}
                        mentions={props.mentions}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

/** Transcript.tsx spacing: each message is one centered, padded column. */
export function AgentTurn(props: { children: JSX.Element }) {
  return (
    <div class="agent-turn">
      <div class="flex flex-col gap-1 min-w-0">{props.children}</div>
    </div>
  );
}
