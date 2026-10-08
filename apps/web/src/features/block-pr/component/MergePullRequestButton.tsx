import GitMerge from '@phosphor/git-merge.svg';
import { Button, type ButtonSize, cn, confirmDialog } from '@ui';
import { getOwner, Show } from 'solid-js';
import {
  createEnableAutoMergeAction,
  createMergePullRequestAction,
  type MergePullRequestTarget,
} from '../primitives/create-merge-pull-request-action';
import { prDisplayName } from '../util/prKey';

/**
 * Merge an open pull request as the signed-in user. Renders nothing unless
 * the pull request is open; GitHub's own permissions decide whether the
 * merge goes through once asked.
 *
 * When merge fails due to pending CI checks, offers to enable auto-merge
 * which will automatically merge the PR once checks pass.
 */
export function MergePullRequestButton(props: {
  target: MergePullRequestTarget;
  status: string | null | undefined;
  size?: ButtonSize;
  class?: string;
  /** Hide the label and show the icon alone, with the label as its name. */
  iconOnly?: boolean;
  onMerged?: () => void;
}) {
  const owner = getOwner();
  const autoMergeAction = createEnableAutoMergeAction();

  const action = createMergePullRequestAction({
    onMerged: props.onMerged,
    confirm: (target) =>
      confirmDialog(
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
                  This will merge the pull request into its base branch on
                  GitHub.
                </p>
              </div>
            );
          },
          confirmLabel: 'Merge pull request',
        },
        { owner }
      ),
    onAutoMergeCandidate: (target, errorMessage) => {
      void confirmDialog(
        {
          title: 'Enable auto-merge?',
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
                <p class="text-sm text-ink-muted">{errorMessage}</p>
                <p>
                  Would you like to enable auto-merge? The pull request will be
                  merged automatically once all required checks pass.
                </p>
              </div>
            );
          },
          confirmLabel: 'Enable auto-merge',
        },
        { owner }
      ).then((confirmed) => {
        if (confirmed) {
          void autoMergeAction.enableAutoMerge(target);
        }
      });
    },
  });

  const pending = () => action.pending() || autoMergeAction.pending();
  const label = () => {
    if (autoMergeAction.pending()) return 'Enabling…';
    if (action.pending()) return 'Merging…';
    return 'Merge';
  };

  return (
    <Show when={props.status === 'open'}>
      <Button
        variant="success"
        size={props.size ?? 'sm'}
        noTouchResize
        class={cn('shrink-0', props.class)}
        aria-label={`${label()} pull request #${props.target.number}`}
        disabled={pending()}
        data-merge-pull-request={props.target.number}
        on:click={(event) => {
          event.stopPropagation();
          void action.merge(props.target);
        }}
      >
        <GitMerge aria-hidden="true" class="size-3.5" />
        <Show when={!props.iconOnly}>
          <span>{label()}</span>
        </Show>
      </Button>
    </Show>
  );
}
