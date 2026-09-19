import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, SegmentedControl } from '@ui';
import { Show } from 'solid-js';
import { pullRequestNumber } from '../core/pull-request';

export type DiffStyleValue = 'unified' | 'split';

export function ChangesHeader(props: {
  /** The pane fills the width; the session is off screen. */
  spotlit: boolean;
  /** `head → base`, when known. */
  range: string | undefined;
  diffStyle: DiffStyleValue;
  onDiffStyle: (style: DiffStyleValue) => void;
  /** The linked pull request, opened by the header action. */
  pullRequestUrl: string | undefined;
  onViewPullRequest: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onSpotlight: () => void;
  onClose: () => void;
}) {
  const pill = () => {
    const url = props.pullRequestUrl;
    const number = url ? pullRequestNumber(url) : undefined;
    if (!props.range) return undefined;
    return number ? `#${number} · ${props.range}` : props.range;
  };
  return (
    <header class="flex h-12 shrink-0 items-center gap-1.5 border-b border-edge pr-2 pl-2.5">
      <Show when={props.spotlit}>
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Bring the session back"
          onClick={() => props.onBack()}
        >
          <ArrowLeftIcon />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1.5">
        <GitBranchIcon class="size-4 shrink-0 text-ink-subtle" />
        <h2 class="truncate text-sm font-semibold text-ink">Changes</h2>
      </div>
      <Show when={pill()}>
        {(text) => (
          <span
            class="inline-flex h-5.5 max-w-64 items-center truncate rounded-full border border-edge-muted px-2 font-mono text-[11px] text-ink-subtle max-lg:hidden"
            title={text()}
          >
            {text()}
          </span>
        )}
      </Show>
      <span class="flex-1" />
      <SegmentedControl
        size="sm"
        aria-label="Diff layout"
        value={props.diffStyle}
        options={[
          { value: 'unified', label: 'Unified' },
          { value: 'split', label: 'Split' },
        ]}
        onChange={props.onDiffStyle}
        class="max-md:hidden"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        tooltip="Refresh pull request changes"
        disabled={props.refreshing}
        onClick={() => props.onRefresh()}
      >
        <ArrowsClockwiseIcon class={cn(props.refreshing && 'animate-spin')} />
      </Button>
      <Show when={props.pullRequestUrl}>
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          onClick={props.onViewPullRequest}
        >
          <GitPullRequestIcon class="size-3.5" />
          <span>View pull request</span>
        </Button>
      </Show>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={props.spotlit}
        tooltip={
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
        tooltip="Close the changes pane"
        onClick={() => props.onClose()}
      >
        <XIcon />
      </Button>
    </header>
  );
}
