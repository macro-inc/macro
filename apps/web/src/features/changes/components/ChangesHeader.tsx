import { DiffStats } from '@app/components/diff-view';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { pullRequestNumber } from '../core/pull-request';

/** Linked PR metadata and totals, expanded-pane title, and pane actions. */
export function ChangesHeader(props: {
  mobile?: boolean;
  /** The pane fills the width; the session is off screen. */
  spotlit: boolean;
  /** `head → base`, when known. */
  range: string | undefined;
  /** The linked pull request, opened from the branch range and number. */
  pullRequestUrl: string | undefined;
  pullRequestTitle?: string;
  changeCounts?: { additions: number; deletions: number };
  onViewPullRequest: () => void;
  onSpotlight?: () => void;
  onClose: () => void;
}) {
  const number = () => {
    const url = props.pullRequestUrl;
    return url ? pullRequestNumber(url) : undefined;
  };
  return (
    <>
      <Show when={props.mobile}>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Back to conversation"
          onClick={props.onClose}
        >
          <ArrowLeftIcon />
        </Button>
      </Show>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Show when={props.spotlit && props.pullRequestTitle}>
          {(title) => (
            <span
              class="min-w-0 max-w-full truncate pt-1 text-sm font-medium text-ink"
              title={title()}
            >
              {title()}
            </span>
          )}
        </Show>
        <div class="flex min-w-0 max-w-full flex-nowrap items-center gap-1 text-xs leading-4">
          <Show
            when={props.pullRequestUrl}
            fallback={
              <Show when={props.range}>
                {(range) => (
                  <span
                    class="flex min-w-0 items-center gap-1 text-ink-subtle"
                    title={range()}
                  >
                    <GitBranchIcon class="size-3.5 shrink-0" />
                    <span class="truncate">{range()}</span>
                  </span>
                )}
              </Show>
            }
          >
            {(url) => (
              <a
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-w-0 items-center gap-1 text-ink-subtle underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={
                  number()
                    ? `View pull request #${number()}`
                    : 'View pull request'
                }
                title={props.range}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  props.onViewPullRequest();
                }}
              >
                <Show when={props.range}>
                  {(range) => (
                    <>
                      <span class="truncate">{range()}</span>
                      <span aria-hidden="true" class="shrink-0">
                        ·
                      </span>
                    </>
                  )}
                </Show>
                <span class="shrink-0">
                  {number() ? `#${number()}` : 'Pull request'}
                </span>
              </a>
            )}
          </Show>
          <Show when={props.changeCounts}>
            {(counts) => (
              <span class="shrink-0 px-1" aria-label="Pull request diff counts">
                <DiffStats
                  additions={counts().additions}
                  deletions={counts().deletions}
                />
              </span>
            )}
          </Show>
        </div>
      </div>
      <Show when={!props.mobile}>
        <Show when={props.onSpotlight}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={props.spotlit}
            label={
              props.spotlit
                ? 'Back to the split'
                : 'Expand changes to the full width'
            }
            onClick={() => props.onSpotlight?.()}
          >
            {props.spotlit ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
          </Button>
        </Show>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Close the changes pane"
          onClick={() => props.onClose()}
        >
          <XIcon />
        </Button>
      </Show>
    </>
  );
}
