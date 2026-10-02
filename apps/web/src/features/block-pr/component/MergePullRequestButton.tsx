import GitMerge from '@phosphor/git-merge.svg';
import { Button, type ButtonSize, cn } from '@ui';
import { Show } from 'solid-js';
import {
  createMergePullRequestAction,
  type MergePullRequestTarget,
} from '../primitives/create-merge-pull-request-action';

/**
 * Merge an open pull request as the signed-in user. Renders nothing unless
 * the pull request is open; GitHub's own permissions decide whether the
 * merge goes through once asked.
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
  const action = createMergePullRequestAction({ onMerged: props.onMerged });
  const label = () => (action.pending() ? 'Merging…' : 'Merge');
  return (
    <Show when={props.status === 'open'}>
      <Button
        variant="success"
        size={props.size ?? 'sm'}
        noTouchResize
        class={cn('shrink-0', props.class)}
        aria-label={`${label()} pull request #${props.target.number}`}
        disabled={action.pending()}
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
