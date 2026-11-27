import { fireAndForget } from '@core/util/fireAndForget';
import GitMerge from '@icon/system/regular/git-merge.svg';
import type { GithubPullRequestMergeability } from '@service-auth/generated/schemas';
import { Button, ButtonGroup, type ButtonSize, cn, confirmDialog } from '@ui';
import { getOwner, type Owner, Show } from 'solid-js';
import {
  createMergePullRequestAction,
  type MergePullRequestTarget,
} from '../primitives/create-merge-pull-request-action';
import {
  PULL_REQUEST_CONFLICT_REASON,
  type PullRequestCheck,
  pullRequestReadyToMerge,
} from '../primitives/pull-request-ready-to-merge';
import { prDisplayName } from '../util/prKey';

/** Ask before merging, naming the pull request. */
export function confirmMergePullRequest(
  target: MergePullRequestTarget,
  owner: Owner | null
) {
  return confirmDialog(
    {
      title: 'Merge pull request?',
      get body() {
        return (
          <div class="space-y-4 pt-2">
            <div class="flex items-start gap-3 rounded-lg border border-edge-muted bg-input p-3">
              <GitMerge
                aria-hidden="true"
                class="mt-0.5 size-4 shrink-0 text-ink-muted"
              />
              <div class="min-w-0 space-y-1">
                <Show when={target.title}>
                  <p class="text-sm font-medium text-ink wrap-anywhere">
                    {target.title}
                  </p>
                </Show>
                <p class="text-xs text-ink-muted wrap-anywhere">
                  {prDisplayName(target)}
                </p>
              </div>
            </div>
            <p>
              This will merge the pull request into its base branch on GitHub.
            </p>
          </div>
        );
      },
      confirmLabel: 'Merge pull request',
    },
    { owner }
  );
}

/**
 * Merge an open pull request as the signed-in user. Renders nothing unless
 * the pull request is open, not a draft, and its checks have finished
 * without failing. GitHub's own permissions decide whether the merge goes
 * through once asked.
 */
export function MergePullRequestButton(props: {
  target: MergePullRequestTarget;
  status: string | null | undefined;
  draft?: boolean | null;
  checks?: readonly PullRequestCheck[] | null;
  mergeability?: GithubPullRequestMergeability | null;
  size?: ButtonSize;
  class?: string;
  /** Hide the label and show the icon alone, with the label as its name. */
  iconOnly?: boolean;
  grouped?: boolean;
  onMerged?: () => void;
}) {
  const owner = getOwner();
  const action = createMergePullRequestAction({
    onMerged: props.onMerged,
    confirm: (target) => confirmMergePullRequest(target, owner),
  });
  const label = () => (action.pending() ? 'Merging…' : 'Merge');
  const Control = props.grouped ? ButtonGroup.Button : Button;
  return (
    <Show
      when={pullRequestReadyToMerge({
        status: props.status,
        draft: props.draft,
        checks: props.checks,
      })}
    >
      <Control
        variant="success"
        size={props.size ?? 'sm'}
        class={cn('shrink-0', props.class)}
        aria-label={`${label()} pull request #${props.target.number}`}
        disabled={
          action.pending() ||
          !pullRequestReadyToMerge({
            status: props.status,
            draft: props.draft,
            checks: props.checks,
            mergeability: props.mergeability,
          })
        }
        tooltip={
          props.mergeability === 'conflicting'
            ? PULL_REQUEST_CONFLICT_REASON
            : undefined
        }
        aria-description={
          props.mergeability === 'conflicting'
            ? PULL_REQUEST_CONFLICT_REASON
            : undefined
        }
        data-merge-pull-request={props.target.number}
        on:click={(event) => {
          event.stopPropagation();
          fireAndForget(action.merge(props.target), 'pr-merge');
        }}
      >
        <GitMerge aria-hidden="true" class="size-3.5" />
        <Show when={!props.iconOnly}>
          <span>{label()}</span>
        </Show>
      </Control>
    </Show>
  );
}
