import { Popover } from '@kobalte/core/popover';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import Check from '@phosphor/check.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import MinusCircle from '@phosphor/minus-circle.svg';
import X from '@phosphor/x.svg';
import CheckCircle from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?component-solid';
import XCircle from '@phosphor-icons/core/assets/fill/x-circle-fill.svg?component-solid';
import { Button, cn, Layer, Surface } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { GithubPullRequestEntity } from '../../types/entity';

type PillProps = {
  children: JSX.Element;
  class?: string;
};

function Pill(props: PillProps) {
  return (
    <span
      class={cn(
        'min-w-0 rounded-full inline-flex items-center gap-1 px-1.5 py-1 leading-tight text-xs font-medium ring ring-edge ring-inset bg-surface/50',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

const numberFormatter = new Intl.NumberFormat();

function checkFailed(conclusion: string | null | undefined): boolean {
  return (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'cancelled' ||
    conclusion === 'action_required'
  );
}

type CheckCounts = {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  pending: number;
};

function checkCounts(entity: GithubPullRequestEntity): CheckCounts {
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;

  for (const check of entity.metadata.checks) {
    if (check.conclusion === 'skipped') {
      skipped += 1;
      continue;
    }

    if (checkFailed(check.conclusion)) {
      failed += 1;
    }

    if (check.conclusion === 'success') {
      successful += 1;
    }

    if (check.status !== 'completed' || check.conclusion == null) {
      pending += 1;
    }
  }

  return {
    total: entity.metadata.checks.length - skipped,
    successful,
    failed,
    skipped,
    pending,
  };
}

function checkOverviewTitle(counts: CheckCounts) {
  if (counts.total === 0) return 'No checks';

  if (counts.failed > 0) {
    return counts.failed === counts.total
      ? 'All checks failed'
      : 'Some checks failed';
  }
  if (counts.pending > 0) return 'Checks pending';
  if (counts.successful === counts.total) return 'All checks succeeded';
  return 'Checks completed';
}

function checkOverviewTitleClass(state: CheckVisualState): string {
  switch (state) {
    case 'success':
      return 'text-success';
    case 'failure':
      return 'text-failure';
    case 'pending':
      return 'text-alert-ink';
    default:
      return 'text-ink';
  }
}

function showCheckCountSummary(counts: CheckCounts) {
  return counts.failed > 0 || counts.pending > 0;
}

const CHECK_RUN_STATE_LABELS: Record<string, string> = {
  action_required: 'Action required',
  cancelled: 'Cancelled',
  completed: 'Completed',
  failure: 'Failed',
  in_progress: 'In progress',
  neutral: 'Neutral',
  pending: 'Pending',
  queued: 'Queued',
  requested: 'Requested',
  skipped: 'Skipped',
  stale: 'Stale',
  startup_failure: 'Startup failure',
  success: 'Success',
  timed_out: 'Timed out',
  waiting: 'Waiting',
};

type CheckVisualState = 'success' | 'failure' | 'pending' | 'skipped' | 'none';

function checkState(entity: GithubPullRequestEntity): CheckVisualState {
  const counts = checkCounts(entity);
  if (counts.total === 0) return 'none';
  if (counts.failed > 0) return 'failure';
  if (counts.pending > 0) return 'pending';
  if (counts.successful === counts.total) return 'success';
  return 'pending';
}

function checkRunState(
  check: GithubPullRequestEntity['metadata']['checks'][number]
): CheckVisualState {
  if (check.conclusion === 'skipped') return 'skipped';

  if (checkFailed(check.conclusion)) return 'failure';

  if (check.status !== 'completed' || check.conclusion == null) {
    return 'pending';
  }

  if (check.conclusion === 'success') return 'success';

  return 'none';
}

function checkStatusText(
  check: GithubPullRequestEntity['metadata']['checks'][number]
) {
  const state = check.conclusion ?? check.status;
  return CHECK_RUN_STATE_LABELS[state] ?? state.replaceAll('_', ' ');
}

function formatDuration(milliseconds: number): string | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;

  if (minutes > 0) return `${minutes}m ${seconds}s`;

  return `${seconds}s`;
}

function checkDurationText(
  check: GithubPullRequestEntity['metadata']['checks'][number],
  now: number
): string | undefined {
  if (check.conclusion === 'skipped' || !check.startedAt) return undefined;

  const started = Date.parse(check.startedAt);
  if (!Number.isFinite(started)) return undefined;

  if (check.status === 'completed') {
    if (!check.completedAt) return undefined;

    const completed = Date.parse(check.completedAt);
    if (!Number.isFinite(completed)) return undefined;

    return formatDuration(completed - started);
  }

  return formatDuration(now - started);
}

function CheckStateIcon(props: {
  state: CheckVisualState;
  circle?: boolean;
  class?: string;
}) {
  return (
    <span
      class={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        props.class
      )}
    >
      <Show when={props.state === 'success'}>
        <Show
          when={props.circle}
          fallback={<Check class="size-3 text-success" />}
        >
          <CheckCircle class="size-5 text-success" />
        </Show>
      </Show>
      <Show when={props.state === 'failure'}>
        <Show when={props.circle} fallback={<X class="size-3 text-failure" />}>
          <XCircle class="size-5 text-failure" />
        </Show>
      </Show>
      <Show when={props.state === 'pending'}>
        <div class="relative size-full inline-flex items-center justify-center">
          <span
            class={cn(
              'size-4 rounded-full',
              props.circle && [
                'size-5',
                'animate-spin',
                'bg-[conic-gradient(from_0deg,var(--color-alert-ink)_0deg,var(--color-alert-ink)_60deg,rgb(from_var(--color-alert-ink)_r_g_b/0.2)_120deg,transparent_260deg,transparent_360deg)]',
                '[mask:radial-gradient(farthest-side,transparent_calc(100%-1.5px),#000_calc(100%-1.5px))]',
              ]
            )}
          />

          <span
            class={cn(
              'absolute rounded-full bg-alert-ink',
              props.circle ? 'size-2' : 'size-1.5'
            )}
          />
        </div>
      </Show>
      <Show when={props.state === 'skipped'}>
        <MinusCircle class="size-5 text-ink-extra-muted/50" />
      </Show>
      <Show when={props.state === 'none'}>
        <div class="relative size-4 inline-flex items-center justify-center">
          <span class="size-1.5 rounded-full bg-ink-muted/40" />
        </div>
      </Show>
    </span>
  );
}

function GithubPullRequestChecksPopover(props: {
  entity: GithubPullRequestEntity;
}) {
  const checks = () => props.entity.metadata.checks;
  const counts = () => checkCounts(props.entity);
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <div class="w-full flex flex-col gap-0.5 text-left">
      <div class="flex items-start gap-2 py-2 pl-4 border-b border-b-edge">
        <CheckStateIcon
          state={checkState(props.entity)}
          class="mt-1 [&_svg]:size-4"
        />
        <div class="flex min-w-0 flex-col">
          <div
            class={cn(
              'text-base font-semibold',
              checkOverviewTitleClass(checkState(props.entity))
            )}
          >
            {checkOverviewTitle(counts())}
          </div>
          <Show when={showCheckCountSummary(counts())}>
            <div class="flex items-center gap-2 text-xs text-ink-extra-muted tabular-nums">
              <span>{counts().successful} succeeded</span>
              <span>{counts().failed} failed</span>
              <span>{counts().skipped} skipped</span>
            </div>
          </Show>
        </div>
      </div>
      <div class="max-h-56 p-2 overflow-y-auto">
        <Show
          when={checks().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <CircleDashed class="size-6 text-ink-extra-muted" />
              <div class="flex flex-col gap-1">
                <div class="text-sm font-medium text-ink">No checks yet</div>
                <div class="max-w-56 text-xs text-ink-extra-muted">
                  GitHub has not reported any check runs for this pull request.
                </div>
              </div>
            </div>
          }
        >
          <div class="flex flex-col gap-0.5">
            <For each={checks()}>
              {(check) => {
                const hasUrl = () => !!check.url;
                return (
                  <Dynamic
                    component={hasUrl() ? 'a' : 'button'}
                    type={!hasUrl() ? 'button' : undefined}
                    class={cn(
                      'group/check-card relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-medium outline-none',
                      hasUrl()
                        ? 'cursor-default hover:bg-active hover:ring hover:ring-edge focus-visible:bg-ink/5'
                        : 'cursor-not-allowed opacity-50'
                    )}
                    href={check.url ? check.url : undefined}
                    disabled={!hasUrl() ? true : undefined}
                  >
                    <CheckStateIcon
                      state={checkRunState(check)}
                      circle={true}
                    />
                    <div class="min-w-0 flex flex-1 items-center gap-2">
                      <span class="truncate font-semibold text-ink">
                        {check.name}
                      </span>{' '}
                      <span class="shrink-0 text-ink-extra-muted/70 capitalize">
                        {checkStatusText(check).replaceAll('_', ' ')}
                      </span>
                    </div>
                    <Show when={checkDurationText(check, now())}>
                      {(duration) => (
                        <span
                          class="w-[7ch] shrink-0 text-right tabular-nums text-ink-extra-muted/70"
                          title={
                            check.status === 'completed'
                              ? 'Duration'
                              : 'Elapsed'
                          }
                        >
                          {duration()}
                        </span>
                      )}
                    </Show>
                    <Layer depth={5}>
                      <span
                        class={cn(
                          'absolute right-1.5 top-1/2 z-10 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md bg-active text-ink-extra-muted opacity-0 shadow-sm ring-1 ring-edge-muted',
                          hasUrl() && 'group-hover/check-card:opacity-100'
                        )}
                      >
                        <ArrowSquareOut class="size-3" />
                      </span>
                    </Layer>
                  </Dynamic>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export function GithubPullRequestChecksIndicator(props: {
  entity: GithubPullRequestEntity;
}) {
  return (
    <Popover placement="bottom-start" gutter={4} flip={true}>
      <Popover.Trigger
        as={Button}
        type="button"
        variant="ghost"
        size="icon-sm"
        noTouchResize={true}
        class="[&_:where(svg)]:size-4 shrink-0"
        onClick={(event) => event.stopPropagation()}
      >
        <CheckStateIcon state={checkState(props.entity)} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-tool-tip max-w-[calc(100vw-32px)] min-w-80"
          onClick={(event) => event.stopPropagation()}
        >
          <Surface
            class="flex items-stretch justify-start rounded-xl w-full"
            depth={3}
          >
            <GithubPullRequestChecksPopover entity={props.entity} />
          </Surface>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

export function GithubPullRequestPills(props: {
  entity: GithubPullRequestEntity;
}) {
  const additions = () => props.entity.metadata.additions;
  const deletions = () => props.entity.metadata.deletions;
  const largestChanges = () =>
    additions() > deletions() ? 'additions' : 'deletions';

  return (
    <>
      <Pill class="tabular-nums">
        <span
          class={cn(
            'text-success/70 group-hover/entity:text-success font-normal',
            largestChanges() === 'additions' && 'font-semibold'
          )}
        >
          +{numberFormatter.format(additions())}
        </span>
        <span
          class={cn(
            'text-failure/70 group-hover/entity:text-failure font-normal',
            largestChanges() === 'deletions' && 'font-semibold'
          )}
        >
          −{numberFormatter.format(deletions())}
        </span>
      </Pill>
      <Pill class="text-ink-muted tabular-nums">
        <ChatCircle class="size-3 shrink-0" />
        {numberFormatter.format(props.entity.metadata.comments.length)}
      </Pill>
    </>
  );
}
