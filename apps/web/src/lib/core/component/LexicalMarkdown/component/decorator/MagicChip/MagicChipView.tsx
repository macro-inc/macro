import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import ArrowsIn from '@phosphor/arrows-in.svg';
import CheckCircle from '@phosphor-fill/check-circle-fill.svg';
import QuestionCircle from '@phosphor-fill/question-fill.svg';
import WarningCircle from '@phosphor-fill/warning-circle-fill.svg';
import { Badge, Button, Card, cn } from '@ui';
import { match } from 'ts-pattern';
import './magic-chip-morph.css';
import { type Component, createMemo, Show } from 'solid-js';
import { MagicChipPullRequest } from './MagicChipPullRequest';
import {
  type MagicChipHeader,
  type MagicChipPresentation,
  presentationLine,
  presentationStatus,
} from './presentation';

type ChipStatus = {
  label: string;
  detail?: string;
  tone:
    | 'neutral'
    | 'active'
    | 'attention'
    | 'success'
    | 'failure'
    | 'tool'
    | 'stopped';
};

function MagicChipStatusIcon(props: { status: ChipStatus; loading?: boolean }) {
  const icon = () =>
    match(props.loading ? 'loading' : props.status.tone)
      .with('loading', () => (
        <span class="size-2 rounded-full bg-ink-muted animate-pulse motion-reduce:animate-none" />
      ))
      .with('failure', () => (
        <WarningCircle aria-hidden="true" class="text-failure" />
      ))
      .with('stopped', () => (
        <span class="size-2.5 rounded-[1px] bg-ink-muted" />
      ))
      .with('success', () => (
        <CheckCircle aria-hidden="true" class="text-success" />
      ))
      .with('active', () => <span class="magic-chip-morph" />)
      .with('attention', () => (
        <QuestionCircle aria-hidden="true" class="text-warning" />
      ))
      .with('neutral', () => (
        <span class="size-2 rounded-full bg-ink-muted animate-pulse motion-reduce:animate-none" />
      ))
      .with('tool', () => <span class="magic-chip-morph" />)
      .exhaustive();

  return (
    <span
      aria-hidden="true"
      class="flex size-5 shrink-0 items-center justify-center [&>svg]:size-5"
      data-magic-chip-status-icon={
        props.loading ? 'loading' : props.status.tone
      }
    >
      {icon()}
    </span>
  );
}

function MagicChipStatusBadge(props: {
  status: ChipStatus;
  loading?: boolean;
}) {
  const tone = () => (props.loading ? 'active' : props.status.tone);
  return (
    <Badge
      size="xs"
      variant="ghost"
      class={cn(
        'min-w-0 max-w-52',
        tone() === 'success' && 'bg-success-bg text-success-ink',
        tone() === 'failure' && 'bg-failure-bg text-failure-ink',
        tone() === 'attention' && 'bg-warning-bg text-warning-ink',
        (tone() === 'active' ||
          tone() === 'neutral' ||
          tone() === 'stopped' ||
          tone() === 'tool') &&
          'bg-hover text-ink-muted'
      )}
    >
      <span
        class="truncate"
        classList={{
          'magic-chip-shimmer':
            !props.loading && props.status.label === 'Thinking',
        }}
      >
        {props.loading ? 'Loading' : props.status.label}
      </span>
    </Badge>
  );
}

/** Fixed-height response card for a live agent session. */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  header?: MagicChipHeader;
  loading?: boolean;
  inDocument?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onOpen?: () => void;
  onCollapse?: () => void;
}> = (props) => {
  const status = createMemo((): ChipStatus => {
    const activity = presentationStatus(props.presentation);
    const tone =
      props.presentation.kind === 'settled'
        ? 'success'
        : props.presentation.kind === 'asking'
          ? 'attention'
          : (activity.tone ?? 'active');
    return {
      label: activity.label,
      tone,
      // Tool details (commands, paths, etc.) stay inside the session.
      detail:
        tone === 'failure' || tone === 'stopped'
          ? activity.detail || activity.label
          : undefined,
    };
  });
  const line = createMemo(() => presentationLine(props.presentation));
  const preview = () => status().detail || line() || status().label;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open agent session"
      class="my-2 w-full min-w-0 max-w-full text-left"
      data-magic-chip={props.agentSessionId}
      data-magic-chip-preview
      data-message-reply-preview={preview()}
      data-lexical-interactive
      on:click={(event) => {
        event.stopPropagation();
        if (
          event.target instanceof Element &&
          event.target.closest('button, a')
        )
          return;
        if (props.onSelect) props.onSelect();
        else props.onOpen?.();
      }}
      on:mousedown={(event) => event.preventDefault()}
      on:keydown={(event) => {
        if (
          event.target !== event.currentTarget ||
          (event.key !== 'Enter' && event.key !== ' ')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        props.onOpen?.();
      }}
    >
      <Card
        depth={2}
        variant={props.inDocument ? 'filled' : 'ghost'}
        contentEditable={false}
        data-magic-chip-card
        aria-label={`${props.header?.agent ?? 'Agent'} session`}
        aria-busy={props.loading}
        class={cn(
          '@container h-22 min-h-22 w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-edge p-3 text-ink',
          props.inDocument &&
            props.selected &&
            'border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] ring-2 ring-edge-muted'
        )}
      >
        <div class="flex h-6 min-w-0 items-center gap-2">
          <MagicChipStatusIcon status={status()} loading={props.loading} />
          <span class="min-w-0 truncate text-xs font-semibold">
            {props.header?.agent ?? 'Agent'}
          </span>
          <Show when={props.header?.model}>
            {(model) => (
              <span
                class="hidden max-w-40 min-w-0 truncate text-xs text-ink-muted @[600px]:block"
                data-magic-chip-model
              >
                {model()}
              </span>
            )}
          </Show>
          <MagicChipStatusBadge status={status()} loading={props.loading} />
          <div class="min-w-0 flex-1" />
          <Show when={props.onCollapse}>
            <Button
              variant="plain"
              size="icon-sm"
              noTouchResize
              aria-label="Collapse to mention"
              on:click={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onCollapse?.();
              }}
            >
              <ArrowsIn />
            </Button>
          </Show>
          <Button
            variant="outline"
            size="sm"
            noTouchResize
            class="aspect-square rounded-full bg-transparent p-0 font-normal @[600px]:aspect-auto @[600px]:px-2"
            aria-label="Open session"
            disabled={props.loading || !props.onOpen}
            on:click={(event) => {
              event.stopPropagation();
              props.onOpen?.();
            }}
          >
            <span class="hidden @[600px]:inline">Open session</span>
            <ArrowUpRight aria-hidden="true" class="size-3" />
          </Button>
        </div>
        <div
          class="mt-1.5 flex h-8 min-w-0 items-center gap-2"
          data-magic-chip-output-row
        >
          <Show
            when={!props.loading}
            fallback={
              <div
                class="flex h-8 min-w-0 flex-1 items-center pl-7"
                aria-hidden="true"
              >
                <span class="h-3 w-4/5 rounded bg-hover" />
              </div>
            }
          >
            <Show
              when={!status().detail && props.header?.pullRequestUrl}
              fallback={
                <p
                  class="h-8 min-w-0 flex-1 truncate pl-7 text-sm leading-8"
                  classList={{
                    italic:
                      status().tone === 'failure' ||
                      Boolean(status().detail) ||
                      !line(),
                  }}
                  data-magic-chip-body
                >
                  {status().detail || line() || 'Nothing written yet'}
                </p>
              }
            >
              {(url) => <MagicChipPullRequest url={url()} />}
            </Show>
          </Show>
        </div>
      </Card>
    </div>
  );
};
