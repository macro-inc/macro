import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { pullRequestNumber } from '../core/pull-request';

/**
 * The pane's title row: what is being reviewed on the left, and only the
 * pane's own controls (full width, close) on the right. Controls for the
 * diffs themselves live in the toolbar below.
 */
export function ChangesHeader(props: {
  /** The pane fills the width; the session is off screen. */
  spotlit: boolean;
  /** `head → base`, when known. */
  range: string | undefined;
  /** The linked pull request, opened from its number. */
  pullRequestUrl: string | undefined;
  onViewPullRequest: () => void;
  onSpotlight: () => void;
  onClose: () => void;
}) {
  const number = () => {
    const url = props.pullRequestUrl;
    return url ? pullRequestNumber(url) : undefined;
  };
  return (
    <>
      <h2 class="shrink-0 px-1 text-sm font-semibold text-ink">Changes</h2>
      <Show when={props.pullRequestUrl}>
        <Button
          variant="ghost"
          size="sm"
          class="shrink-0"
          label={
            number() ? `View pull request #${number()}` : 'View pull request'
          }
          onClick={() => props.onViewPullRequest()}
        >
          <GitPullRequestIcon />
          <span>{number() ? `#${number()}` : 'Pull request'}</span>
        </Button>
      </Show>
      <Show when={props.range}>
        {(range) => (
          <span
            class="flex min-w-0 items-center gap-1 text-xs text-ink-subtle max-md:hidden"
            title={range()}
          >
            <GitBranchIcon class="size-3.5 shrink-0" />
            <span class="truncate">{range()}</span>
          </span>
        )}
      </Show>
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={props.spotlit}
        label={
          props.spotlit
            ? 'Back to the split'
            : 'Expand changes to the full width'
        }
        onClick={() => props.onSpotlight()}
      >
        {props.spotlit ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Close the changes pane"
        onClick={() => props.onClose()}
      >
        <XIcon />
      </Button>
    </>
  );
}
