import ChatCircle from '@phosphor/chat-circle.svg';
import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';
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

export function GithubPullRequestPills(props: {
  entity: GithubPullRequestEntity;
}) {
  const additions = () => props.entity.subType.additions;
  const deletions = () => props.entity.subType.deletions;
  const additionsAreLarger = () => additions() > deletions();
  const deletionsAreLarger = () => deletions() > additions();
  const comments = () => props.entity.subType.comments.length;
  const checks = () => props.entity.subType.checks;
  const countedChecks = () =>
    checks().filter((check) => check.conclusion !== 'skipped');
  const failedChecks = () =>
    countedChecks().filter((check) => checkFailed(check.conclusion)).length;
  const successfulChecks = () =>
    countedChecks().filter((check) => check.conclusion === 'success').length;
  const checkSummary = () => {
    const total = countedChecks().length;
    if (total === 0) return '0';
    return `${successfulChecks()} of ${total}`;
  };
  const checkStatusClass = () => {
    if (countedChecks().length === 0) return 'bg-ink-muted/50';
    if (failedChecks() > 0) {
      return 'bg-failure/70 group-hover/entity:bg-failure';
    }
    if (successfulChecks() === countedChecks().length) {
      return 'bg-success/70 group-hover/entity:bg-success';
    }
    return 'bg-ink-muted/50';
  };

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
            'text-success/70 group-hover/entity:text-success',
            additionsAreLarger() && 'font-semibold'
          )}
        >
          +{numberFormatter.format(additions())}
        </span>
        <span
          class={cn(
            'text-failure/70 group-hover/entity:text-failure',
            deletionsAreLarger() && 'font-semibold'
          )}
        >
          −{numberFormatter.format(deletions())}
        </span>
      </Pill>
      <Pill class="text-ink-muted tabular-nums">
        <span
          class={cn('size-1.5 rounded-full shrink-0', checkStatusClass())}
        />
        {checkSummary()}
      </Pill>
      <Pill class="text-ink-muted tabular-nums">
        {iconText(ChatCircle, numberFormatter.format(comments()))}
      </Pill>
    </>
  );
}
