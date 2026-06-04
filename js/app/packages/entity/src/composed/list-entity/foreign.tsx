import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
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

type GithubPullRequestStatus = GithubPullRequestEntity['subType']['status'];

function statusConfig(status: GithubPullRequestStatus): {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  class: string;
} {
  switch (status) {
    case 'open':
      return {
        icon: GitPullRequest,
        class: 'text-success/70 group-hover/entity:text-success'
      };
    case 'merged':
      return {
        icon: GitMerge,
        class: 'text-note/70 group-hover/entity:text-note'
      };
    case 'closed':
      return {
        icon: GitPullRequest,
        class: 'text-failure/70 group-hover/entity:text-failure'
      };
  }
}

export function GithubPullRequestPills(props: {
  entity: GithubPullRequestEntity;
}) {
  const status = () => props.entity.subType.status;
  const config = () => statusConfig(status());
  const additions = () => props.entity.subType.additions;
  const deletions = () => props.entity.subType.deletions;
  const additionsAreLarger = () => additions() > deletions();
  const deletionsAreLarger = () => deletions() > additions();

  return (
    <>
      <Pill class={config().class}>
        <Dynamic component={config().icon} class="size-3 shrink-0" />
        <span class="capitalize">{status()}</span>
      </Pill>
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
    </>
  );
}
