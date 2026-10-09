import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { PopupPreview } from '@core/component/DocumentPreview';
import { HoverCard } from '@core/component/HoverCard';
import { useChannelName } from '@core/context/channels';
import {
  rowPillClasses,
  rowPillTriggerClasses,
} from '@entity/components/row-pill';
import MacroIcon from '@icon/macro-logo.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { Popover } from '@kobalte/core/popover';
import BuildingsIcon from '@phosphor/buildings.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import HashIcon from '@phosphor/hash.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import RobotIcon from '@phosphor/robot.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { cn, Surface, Tooltip } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  PR_PRIORITY_LABELS,
  type PrChannelOrigin,
  type PrLinks,
  type PrPriority,
  type PrPriorityId,
} from '../data/pr-links';
import {
  PR_ORIGIN_LABELS,
  PR_ORIGIN_SIGNAL_LABELS,
  type PrOrigin,
  type PrOriginTool,
} from '../data/pr-origin';

/** Opens a linked item; `newSplit` when the viewer asked for another split. */
export type OpenPrLink = (content: SplitContent, newSplit: boolean) => void;

const PRIORITY_OPTION_IDS: Record<Exclude<PrPriorityId, 'none'>, string> = {
  urgent: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
  high: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  medium: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  low: PROPERTY_OPTION_IDS.PRIORITY.LOW,
};

/** Keeps a chip's pointer and key events from also activating the row under it. */
const isolate = {
  onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
  onPointerDown: (event: PointerEvent) => event.stopPropagation(),
};

function priorityTooltip(priority: PrPriority, taskName?: string) {
  if (priority.id === 'none') return PR_PRIORITY_LABELS.none;
  const label = `${PR_PRIORITY_LABELS[priority.id]} priority`;
  if (priority.source === 'label') return `${label}, from a GitHub label`;
  return taskName ? `${label}, from ${taskName}` : label;
}

/** A priority's icon; `none` draws an empty slot. */
export function PrPriorityIcon(props: {
  priority: PrPriorityId;
  class?: string;
}) {
  return (
    <Show
      when={props.priority !== 'none' && props.priority}
      fallback={<span class={cn('inline-block size-3', props.class)} />}
    >
      {(id) => (
        <PropertyValueIcon
          optionId={PRIORITY_OPTION_IDS[id()]}
          class={props.class}
        />
      )}
    </Show>
  );
}

/** The pull request's priority, from its linked tasks or GitHub labels. */
export function PrPriorityBadge(props: {
  priority: PrPriority;
  taskName?: string;
}) {
  return (
    <Show when={props.priority.id !== 'none' && props.priority.id}>
      {(id) => (
        <Tooltip
          as="span"
          label={priorityTooltip(props.priority, props.taskName)}
          class="inline-flex size-4 shrink-0 items-center justify-center"
        >
          <span
            role="img"
            aria-label={`${PR_PRIORITY_LABELS[id()]} priority`}
            class="inline-flex"
          >
            <PrPriorityIcon priority={id()} />
          </span>
        </Tooltip>
      )}
    </Show>
  );
}

type LinkItem = {
  key: string;
  content: SplitContent;
  label: () => JSX.Element;
  /** Plain-text detail for the chip's tooltip, when the label is not plain text. */
  text?: () => string;
};

/**
 * One kind of link: opens the item directly when there is one, or lists them
 * in a popover when there are several.
 */
function LinkPill(props: {
  kind: string;
  icon: Component<{ class?: string }>;
  items: LinkItem[];
  onOpen: OpenPrLink;
  class?: string;
}) {
  const first = () => props.items[0];
  const body = () => (
    <>
      <props.icon class="size-3 shrink-0" />
      <span data-pill-text class="min-w-0 truncate">
        {first()?.label()}
      </span>
      <Show when={props.items.length > 1}>
        <span data-pill-text class="shrink-0 tabular-nums text-ink-extra-muted">
          +{props.items.length - 1}
        </span>
      </Show>
    </>
  );

  return (
    <Show when={first()}>
      {(item) => (
        <Show
          when={props.items.length > 1}
          fallback={
            <Tooltip
              as="span"
              label={
                item().text ? `${props.kind}: ${item().text?.()}` : props.kind
              }
            >
              <button
                type="button"
                class={rowPillTriggerClasses(cn('max-w-40', props.class))}
                aria-label={`Open linked ${props.kind.toLowerCase()}`}
                {...isolate}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpen(item().content, event.shiftKey);
                }}
              >
                {body()}
              </button>
            </Tooltip>
          }
        >
          <Popover placement="bottom-end" gutter={4} flip>
            <Popover.Trigger
              class={rowPillTriggerClasses(cn('max-w-40', props.class))}
              aria-label={`${props.items.length} linked ${props.kind.toLowerCase()}s`}
              {...isolate}
              onClick={(event: MouseEvent) => event.stopPropagation()}
            >
              {body()}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                class="z-tool-tip w-64 max-w-[calc(100vw-32px)]"
                {...isolate}
                onClick={(event: MouseEvent) => event.stopPropagation()}
              >
                <Surface
                  class="flex flex-col gap-0.5 rounded-xl p-1 glass bg-menu-glass"
                  depth={3}
                  hideBorder
                >
                  <div class="px-2 py-1 text-xxs font-medium uppercase text-ink-extra-muted">
                    {props.kind}s
                  </div>
                  <For each={props.items}>
                    {(entry) => (
                      <button
                        type="button"
                        class="flex h-7 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                        onClick={(event) =>
                          props.onOpen(entry.content, event.shiftKey)
                        }
                      >
                        <props.icon class="size-3.5 shrink-0 text-ink-muted" />
                        <span class="min-w-0 truncate">{entry.label()}</span>
                      </button>
                    )}
                  </For>
                </Surface>
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </Show>
      )}
    </Show>
  );
}

/** The channel message an agent was started from, opened at that message. */
const channelOriginContent = (origin: PrChannelOrigin): SplitContent => ({
  type: 'channel',
  id: origin.channelId,
  params: origin.messageId
    ? { [CHANNEL_URL_PARAMS.message]: origin.messageId }
    : undefined,
});

function ChannelOriginPill(props: {
  origin: PrChannelOrigin;
  /** Show only the mark, for the pills stacked behind the first. */
  stacked: boolean;
  onOpen: OpenPrLink;
}) {
  const name = useChannelName(props.origin.channelId, 'Channel');
  const pill = () => (
    <button
      type="button"
      class={rowPillTriggerClasses('max-w-40')}
      aria-label={`Open the message in #${name()} that started the agent`}
      {...isolate}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen(channelOriginContent(props.origin), event.shiftKey);
      }}
    >
      <HashIcon class="size-3 shrink-0" />
      <span
        data-pill-text
        class={cn(
          'min-w-0 truncate',
          props.stacked && 'hidden group-hover/channels:inline'
        )}
      >
        {name()}
      </span>
    </button>
  );
  return (
    <Show
      when={props.origin.messageId}
      fallback={
        <Tooltip as="span" label={`Started from #${name()}`}>
          {pill()}
        </Tooltip>
      }
    >
      {(messageId) => (
        <HoverCard
          triggerClass="min-w-0"
          trigger={pill()}
          content={
            <PopupPreview
              mouseEnter={() => {}}
              mouseLeave={() => {}}
              documentInfo={{
                id: props.origin.channelId,
                type: 'channel',
                params: { [CHANNEL_URL_PARAMS.message]: messageId() },
                isOpenable: true,
              }}
            />
          }
        />
      )}
    </Show>
  );
}

/**
 * The channel messages the linked agents were started from, such as an
 * @mention. Several overlap as a stack that spreads out on hover; each
 * previews its message on hover and opens the channel at it.
 */
function ChannelOriginPills(props: {
  origins: readonly PrChannelOrigin[];
  onOpen: OpenPrLink;
}) {
  return (
    <Show when={props.origins.length > 0}>
      <span
        class="group/channels flex min-w-0 shrink items-center [&>*+*]:-ml-2 hover:[&>*+*]:ml-0.5 [&>*]:relative [&>*]:transition-[margin] [&>*:hover]:z-10"
        aria-label={`Started from ${props.origins.length} channel ${
          props.origins.length === 1 ? 'message' : 'messages'
        }`}
      >
        <For each={props.origins}>
          {(origin, index) => (
            <ChannelOriginPill
              origin={origin}
              stacked={index() > 0}
              onOpen={props.onOpen}
            />
          )}
        </For>
      </span>
    </Show>
  );
}

/**
 * Chips for where a pull request was started (the tool and the channel
 * messages its agents came from) and the customers and tickets it links to.
 * Each opens the linked item in a split. Agent sessions have their own chip.
 */
export function PrLinkChips(props: {
  links: PrLinks;
  companyName: (id: string) => string | undefined;
  onOpen: OpenPrLink;
}) {
  const tasks = (): LinkItem[] =>
    props.links.tasks.map((task) => ({
      key: task.id,
      content: { type: 'md', id: task.id },
      text: () => task.name || 'Untitled task',
      label: () => (
        <span class="flex min-w-0 items-center gap-1">
          <PrPriorityIcon priority={task.priority} class="shrink-0" />
          <span
            class={cn(
              'min-w-0 truncate',
              task.closed && 'text-ink-muted line-through'
            )}
          >
            {task.name || 'Untitled task'}
          </span>
        </span>
      ),
    }));
  const companies = (): LinkItem[] =>
    props.links.companyIds.map((id) => {
      const text = () => props.companyName(id) ?? 'Customer';
      return {
        key: id,
        content: { type: 'company', id },
        text,
        label: text,
      };
    });

  // Contents, so a compacting row can stack these pills with its own.
  return (
    <span class="contents">
      <Show when={props.links.origin}>
        {(origin) => <PrOriginBadge origin={origin()} onOpen={props.onOpen} />}
      </Show>
      <ChannelOriginPills
        origins={props.links.channelOrigins}
        onOpen={props.onOpen}
      />
      <LinkPill
        kind="Customer"
        icon={BuildingsIcon}
        items={companies()}
        onOpen={props.onOpen}
      />
      <LinkPill
        kind="Ticket"
        icon={ListChecksIcon}
        items={tasks()}
        onOpen={props.onOpen}
      />
    </span>
  );
}

/** The mark of the tool a pull request was started from. */
export function PrOriginIcon(props: { tool: PrOriginTool; class?: string }) {
  const icon = () =>
    match(props.tool)
      .with('claude', () => ClaudeIcon)
      .with('codex', () => CodexIcon)
      .with('cursor', () => CursorIcon)
      .with('macro', () => MacroIcon)
      .with('copilot', () => GithubIcon)
      .with('devin', 'jules', () => RobotIcon)
      .exhaustive();
  return (
    <Dynamic
      component={icon()}
      class={cn('size-3 shrink-0', props.class)}
      aria-hidden="true"
    />
  );
}

/** "Claude, from its branch name"; Macro sessions say which tool they ran. */
export function prOriginDescription(origin: PrOrigin) {
  const tool = PR_ORIGIN_LABELS[origin.tool];
  if (origin.signal === 'agent-session')
    return origin.tool === 'macro'
      ? 'Started from a Macro agent session'
      : `Started from ${tool} in a Macro agent session`;
  return `Started from ${tool}, ${PR_ORIGIN_SIGNAL_LABELS[origin.signal]}`;
}

/**
 * Where the pull request was started. Opens the originating session: the
 * Macro agent session in a split, or the external session link in a tab.
 */
export function PrOriginBadge(props: { origin: PrOrigin; onOpen: OpenPrLink }) {
  const target = () => props.origin.sessionId ?? props.origin.url;
  const content = () => (
    <>
      <PrOriginIcon tool={props.origin.tool} />
      <span data-pill-text class="min-w-0 truncate">
        {PR_ORIGIN_LABELS[props.origin.tool]}
      </span>
    </>
  );
  return (
    <Tooltip as="span" label={prOriginDescription(props.origin)}>
      <Show
        when={target()}
        fallback={
          <span
            class={rowPillClasses('max-w-32')}
            aria-label={prOriginDescription(props.origin)}
          >
            {content()}
          </span>
        }
      >
        <button
          type="button"
          class={rowPillTriggerClasses('max-w-32')}
          aria-label={`${prOriginDescription(props.origin)}. Open the session`}
          {...isolate}
          onClick={(event) => {
            event.stopPropagation();
            const sessionId = props.origin.sessionId;
            if (sessionId)
              props.onOpen({ type: 'agent', id: sessionId }, event.shiftKey);
            else if (props.origin.url)
              window.open(props.origin.url, '_blank', 'noopener,noreferrer');
          }}
        >
          {content()}
        </button>
      </Show>
    </Tooltip>
  );
}

/** Space-holding placeholder while a row's links load, so pills don't shift. */
export function PrLinksPending() {
  return (
    <span
      aria-hidden="true"
      class="h-6 w-12 shrink-0 animate-pulse rounded-full bg-ink/5"
    />
  );
}
