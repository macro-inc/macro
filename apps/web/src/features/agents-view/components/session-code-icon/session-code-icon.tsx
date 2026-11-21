import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import { cn } from '@ui';
import { Match, Switch } from 'solid-js';
import type { SessionCodeDetails } from '../../core/session-code-details';

export function SessionCodeIcon(props: { details: SessionCodeDetails }) {
  return (
    <span
      class="flex size-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <Switch>
        <Match when={props.details.pullRequest?.status === 'merged'}>
          <GitMergeIcon class="size-3 text-note" />
        </Match>
        <Match when={props.details.pullRequest}>
          <GitPullRequestIcon
            class={cn(
              'size-3',
              props.details.pullRequest?.status === 'open' && 'text-success',
              props.details.pullRequest?.status === 'closed' && 'text-failure',
              (!props.details.pullRequest?.status ||
                props.details.pullRequest?.status === 'draft') &&
                'text-ink-muted'
            )}
          />
        </Match>
        <Match when={props.details.branch}>
          <GitBranchIcon class="size-3 text-ink-extra-muted" />
        </Match>
      </Switch>
    </span>
  );
}
