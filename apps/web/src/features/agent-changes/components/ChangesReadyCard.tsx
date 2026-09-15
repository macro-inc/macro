import { DiffChanges } from '@app/features/block-agent/ui/DiffChanges';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import RowsIcon from '@phosphor/rows.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { describeFileCount } from '../core/changeset';
import { pullRequestNumber } from '../core/pull-request';

/** The transcript's hand-off card into the Changes pane. */
export function ChangesReadyCard(props: {
  fileCount: number;
  additions: number;
  deletions: number;
  linkedUrl: string | undefined;
  creating: boolean;
  onReview: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onViewPullRequest: () => void;
  onDismiss: () => void;
}) {
  const linkedNumber = () =>
    props.linkedUrl ? pullRequestNumber(props.linkedUrl) : undefined;
  return (
    <section
      class="flex flex-col gap-2.5 rounded-xl bg-surface-1 p-3 shadow-[inset_0_0_0_1px_var(--color-edge-muted)]"
      aria-label="Changes ready to review"
    >
      <div class="flex items-center gap-2">
        <GitBranchIcon class="size-4 shrink-0 text-accent" />
        <span class="text-[12.5px] font-semibold text-ink">
          Changes ready to review
        </span>
        <span class="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          tooltip="Dismiss"
          onClick={() => props.onDismiss()}
        >
          <XIcon />
        </Button>
      </div>
      <div class="flex items-center gap-2 font-mono text-[11px] text-ink-placeholder">
        <span>{describeFileCount(props.fileCount)}</span>
        <DiffChanges
          variant="bars"
          additions={props.additions}
          deletions={props.deletions}
        />
        <DiffChanges additions={props.additions} deletions={props.deletions} />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          onClick={() => props.onReview()}
        >
          <RowsIcon class="size-3.5" />
          <span>Review changes</span>
        </Button>
        <Show
          when={!props.linkedUrl}
          fallback={
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5"
              onClick={() => props.onViewPullRequest()}
            >
              <GitPullRequestIcon class="size-3.5" />
              <span>
                {linkedNumber()
                  ? `Pull request #${linkedNumber()}`
                  : 'Pull request'}
              </span>
            </Button>
          }
        >
          <Button
            variant="cta"
            size="sm"
            class="gap-1.5"
            disabled={props.creating}
            onClick={() => props.onCreate()}
          >
            <GitPullRequestIcon class="size-3.5" />
            <span>{props.creating ? 'Creating…' : 'Create pull request'}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => props.onEdit()}>
            Edit details…
          </Button>
        </Show>
      </div>
    </section>
  );
}
