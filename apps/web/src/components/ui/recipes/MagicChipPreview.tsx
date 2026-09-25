import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import ArrowsIn from '@phosphor/arrows-in.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import CheckCircle from '@phosphor-fill/check-circle-fill.svg';
import QuestionCircle from '@phosphor-fill/question-fill.svg';
import WarningCircle from '@phosphor-fill/warning-circle-fill.svg';
import { children, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { cn } from '../utils/classname';
import './magic-chip-morph.css';

export type MagicChipPreviewStatus = {
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

export type MagicChipPreviewProps = {
  agent: string;
  model?: string;
  status: MagicChipPreviewStatus;
  body: string;
  pullRequest?: {
    number: number;
    title: string;
    additions?: number;
    deletions?: number;
  };
  loading?: boolean;
  outputSlot?: JSX.Element;
  onCollapse?: () => void;
  onOpen?: () => void;
  onPreview?: () => void;
};

/** Shared by the standalone status gallery and the session chip. */
export function MagicChipStatusIcon(props: {
  status: MagicChipPreviewStatus;
  loading?: boolean;
}) {
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

export function MagicChipStatusBadge(props: {
  status: MagicChipPreviewStatus;
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

/** Shared session card: presentation only, with host-owned actions and data. */
export function MagicChipPreview(props: MagicChipPreviewProps) {
  const outputSlot = children(() => props.outputSlot);
  const previewLabel = () =>
    props.pullRequest
      ? `#${props.pullRequest.number} · ${props.pullRequest.title}`
      : '';
  const errorDetail = () =>
    props.status.tone === 'failure' || props.status.tone === 'stopped'
      ? props.status.detail
      : undefined;
  const output = () => errorDetail() || props.body || 'Nothing written yet';

  return (
    <article
      data-magic-chip-demo
      aria-label={`${props.agent} session`}
      aria-busy={props.loading}
      class="@container h-22 min-h-22 w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-edge p-3 text-ink"
    >
      <div class="flex h-6 min-w-0 items-center gap-2">
        <MagicChipStatusIcon status={props.status} loading={props.loading} />
        <span class="min-w-0 truncate text-xs font-semibold">
          {props.agent}
        </span>
        <Show when={props.model}>
          {(model) => (
            <span
              class="hidden max-w-40 min-w-0 truncate text-xs text-ink-muted @[600px]:block"
              data-magic-chip-model
            >
              {model()}
            </span>
          )}
        </Show>
        <MagicChipStatusBadge status={props.status} loading={props.loading} />
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
            when={(outputSlot() || props.pullRequest) && !errorDetail()}
            fallback={
              <p
                class="h-8 min-w-0 flex-1 truncate pl-7 text-sm leading-8"
                classList={{
                  italic:
                    props.status.tone === 'failure' ||
                    Boolean(errorDetail()) ||
                    !props.body,
                }}
                data-magic-chip-body
              >
                {output()}
              </p>
            }
          >
            <Show
              when={outputSlot()}
              fallback={
                <div class="w-full min-w-0">
                  <Button
                    variant="plain"
                    size="sm"
                    fullWidth
                    noTouchResize
                    class="h-8 min-w-0 justify-start rounded-lg bg-hover p-2"
                    aria-label={previewLabel()}
                    on:click={(event) => {
                      event.stopPropagation();
                      props.onPreview?.();
                    }}
                    data-magic-chip-preview-action
                  >
                    <GitPullRequest aria-hidden="true" class="size-3.5" />
                    <span class="min-w-0 flex-1 truncate text-left">
                      {previewLabel()}
                    </span>
                    <Show when={props.pullRequest?.additions != null}>
                      <span
                        class="shrink-0 font-mono tabular-nums text-success"
                        aria-label={`${props.pullRequest?.additions} lines added`}
                      >
                        +{props.pullRequest?.additions}
                      </span>
                    </Show>
                    <Show when={props.pullRequest?.deletions != null}>
                      <span
                        class="shrink-0 font-mono tabular-nums text-failure"
                        aria-label={`${props.pullRequest?.deletions} lines deleted`}
                      >
                        −{props.pullRequest?.deletions}
                      </span>
                    </Show>
                  </Button>
                </div>
              }
            >
              {outputSlot()}
            </Show>
          </Show>
        </Show>
      </div>
    </article>
  );
}
