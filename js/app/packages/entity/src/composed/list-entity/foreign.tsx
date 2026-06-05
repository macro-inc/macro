import { openExternalUrl } from '@core/util/url';
import { Popover } from '@kobalte/core/popover';
import CaretRight from '@phosphor/caret-right.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import Check from '@phosphor/check.svg';
import DashedCircle from '@phosphor/circle-dashed.svg';
import MinusCircle from '@phosphor/minus-circle.svg';
import X from '@phosphor/x.svg';
import CheckCircle from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?component-solid';
import XCircle from '@phosphor-icons/core/assets/fill/x-circle-fill.svg?component-solid';
import { Button, cn, Surface } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
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

function iconText(
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>,
  text: JSX.Element
) {
  return (
    <>
      <Dynamic component={icon} class="size-3 shrink-0" />
      {text}
    </>
  );
}

function checkFailed(conclusion: string | null | undefined): boolean {
  return (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'cancelled' ||
    conclusion === 'action_required'
  );
}

function countedChecks(entity: GithubPullRequestEntity) {
  return entity.metadata.checks.filter(
    (check) => check.conclusion !== 'skipped'
  );
}

function failedChecks(entity: GithubPullRequestEntity) {
  return countedChecks(entity).filter((check) => checkFailed(check.conclusion))
    .length;
}

function successfulChecks(entity: GithubPullRequestEntity) {
  return countedChecks(entity).filter((check) => check.conclusion === 'success')
    .length;
}

function skippedChecks(entity: GithubPullRequestEntity) {
  return entity.metadata.checks.filter(
    (check) => check.conclusion === 'skipped'
  ).length;
}

function pendingChecks(entity: GithubPullRequestEntity) {
  return countedChecks(entity).filter(
    (check) => check.status !== 'completed' || check.conclusion == null
  ).length;
}

function checkSummary(entity: GithubPullRequestEntity) {
  const total = countedChecks(entity).length;
  if (total === 0) return 'No checks';
  return `${successfulChecks(entity)} of ${total} checks passed`;
}

function checkOverviewTitle(entity: GithubPullRequestEntity) {
  const total = countedChecks(entity).length;
  if (total === 0) return 'No checks';
  if (failedChecks(entity) > 0) {
    return failedChecks(entity) === total
      ? 'All checks failed'
      : 'Some checks failed';
  }
  if (pendingChecks(entity) > 0) return 'Checks pending';
  if (successfulChecks(entity) === total) return 'All checks succeeded';
  return 'Checks completed';
}

function showCheckCountSummary(entity: GithubPullRequestEntity) {
  return failedChecks(entity) > 0 || pendingChecks(entity) > 0;
}

type CheckVisualState = 'success' | 'failure' | 'pending' | 'skipped' | 'none';

function checkState(entity: GithubPullRequestEntity): CheckVisualState {
  const total = countedChecks(entity).length;
  if (total === 0) return 'none';
  if (failedChecks(entity) > 0) return 'failure';
  if (pendingChecks(entity) > 0) return 'pending';
  if (successfulChecks(entity) === total) return 'success';
  return 'pending';
}

function checkRunState(
  check: GithubPullRequestEntity['metadata']['checks'][number]
): CheckVisualState {
  if (check.conclusion === 'skipped') return 'skipped';
  if (checkFailed(check.conclusion)) return 'failure';
  if (check.status !== 'completed' || check.conclusion == null)
    return 'pending';
  if (check.conclusion === 'success') return 'success';
  return 'none';
}

function checkStatusText(
  check: GithubPullRequestEntity['metadata']['checks'][number]
) {
  if (check.conclusion === 'success') return 'Success';
  if (check.conclusion === 'skipped') return 'Skipped';
  if (checkFailed(check.conclusion)) return check.conclusion ?? 'Failed';
  if (check.conclusion) return check.conclusion;
  return check.status;
}

function CheckStateIcon(props: { state: CheckVisualState; circle?: boolean }) {
  return (
    <span class="relative inline-flex shrink-0 items-center justify-center">
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
              'animate-spin rounded-full',
              'bg-[conic-gradient(from_0deg,var(--color-alert-ink)_0deg,var(--color-alert-ink)_60deg,rgb(from_var(--color-alert-ink)_r_g_b/0.2)_120deg,transparent_260deg,transparent_360deg)]',
              '[mask:radial-gradient(farthest-side,transparent_calc(100%-1.5px),#000_calc(100%-1.5px))]',
              props.circle ? 'size-5' : 'size-3.5'
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
        <span class="size-1.5 rounded-full bg-ink-muted/40" />
      </Show>
    </span>
  );
}

function GithubPullRequestChecksTooltip(props: {
  entity: GithubPullRequestEntity;
}) {
  const checks = () => props.entity.metadata.checks;

  return (
    <div class="flex flex-col gap-2 text-left">
      <div class="flex flex-col gap-1">
        <div class="text-base font-semibold text-ink">
          {checkOverviewTitle(props.entity)}
        </div>
        <Show when={showCheckCountSummary(props.entity)}>
          <div class="flex items-center gap-2 text-[11px] text-ink-extra-muted tabular-nums">
            <span>{successfulChecks(props.entity)} succeeded</span>
            <span>{failedChecks(props.entity)} failed</span>
            <span>{skippedChecks(props.entity)} skipped</span>
          </div>
        </Show>
      </div>
      <div class="max-h-56 overflow-y-auto pr-1">
        <Show
          when={checks().length > 0}
          fallback={<div class="text-ink-extra-muted">No checks</div>}
        >
          <div class="flex flex-col gap-1.5">
            <For each={checks()}>
              {(check) => {
                const hasUrl = () => !!check.url;
                return (
                  <Dynamic
                    component={hasUrl() ? 'a' : 'button'}
                    type={!hasUrl() ? 'button' : undefined}
                    class={cn(
                      'group/check-card flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
                      hasUrl() && 'hover:bg-active/50'
                    )}
                    href={check.url ? check.url : undefined}
                    disabled={!hasUrl() ? true : undefined}
                  >
                    <CheckStateIcon
                      state={checkRunState(check)}
                      circle={true}
                    />
                    <div class="min-w-0 flex gap-2 flex-1 text-sm">
                      <span class="font-semibold text-ink whitespace-nowrap">
                        {check.name}
                      </span>{' '}
                      <span class="text-sm text-ink-extra-muted/70 capitalize">
                        {checkStatusText(check).replaceAll('_', ' ')}
                      </span>
                    </div>
                    <CaretRight
                      class={cn(
                        'size-3 shrink-0 text-ink-extra-muted opacity-0 transition-opacity',
                        hasUrl() && 'group-hover/check-card:opacity-100'
                      )}
                    />
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
          class="z-tool-tip max-w-[calc(100vw-32px)]"
          onClick={(event) => event.stopPropagation()}
        >
          <Surface
            class="flex items-stretch justify-start p-2  rounded-2xl"
            depth={2}
          >
            <GithubPullRequestChecksTooltip entity={props.entity} />
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
  const additionsAreLarger = () => additions() > deletions();
  const deletionsAreLarger = () => deletions() > additions();
  const comments = () => props.entity.metadata.comments.length;

  return (
    <>
      {/* <Pill class="text-ink-muted"> */}
      {/*   <Dynamic */}
      {/*     component={config().icon} */}
      {/*     class={cn('size-3 shrink-0', config().iconClass)} */}
      {/*   /> */}
      {/*   <span class="capitalize">{status()}</span> */}
      {/* </Pill> */}
      <Pill class="tabular-nums">
        <span
          class={cn(
            'text-success/70 group-hover/entity:text-success font-light',
            additionsAreLarger() && 'font-semibold'
          )}
        >
          +{numberFormatter.format(additions())}
        </span>
        <span
          class={cn(
            'text-failure/70 group-hover/entity:text-failure font-light',
            deletionsAreLarger() && 'font-semibold'
          )}
        >
          −{numberFormatter.format(deletions())}
        </span>
      </Pill>
      <Pill class="text-ink-muted tabular-nums">
        {iconText(ChatCircle, numberFormatter.format(comments()))}
      </Pill>
    </>
  );
}
