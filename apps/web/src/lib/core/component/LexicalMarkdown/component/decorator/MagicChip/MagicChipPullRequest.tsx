import {
  parseGithubPrUrl,
  prDisplayName,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { Button, buttonClasses } from '@ui';
import { type Component, createMemo, Show } from 'solid-js';

/** Resolves a live PR without suspending the surrounding message/editor. */
export const MagicChipPullRequest: Component<{ url: string }> = (props) => {
  const layout = useSplitLayout();
  const reference = createMemo(() => parseGithubPrUrl(props.url));
  const githubKey = createMemo(() => {
    const parsed = reference();
    return parsed ? toGithubKey(parsed) : undefined;
  });
  const query = usePullRequestByGithubKeyQuery(githubKey);
  const entity = () => (query.isSuccess ? query.data : undefined);
  const metadata = (): Record<string, unknown> => {
    const value = entity()?.metadata;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };
  const label = () => {
    const title = metadata().name;
    const parsed = reference();
    return typeof title === 'string' && title
      ? `${parsed ? `#${parsed.number} · ` : ''}${title}`
      : parsed
        ? prDisplayName(parsed)
        : 'Pull request';
  };
  const count = (key: 'additions' | 'deletions') => {
    const value = metadata()[key];
    return typeof value === 'number' ? value : undefined;
  };
  const content = () => (
    <>
      <Show
        when={metadata().status === 'merged'}
        fallback={
          <GitPullRequest
            aria-hidden="true"
            class="size-3.5"
            classList={{
              'text-success': metadata().status === 'open',
              'text-failure': metadata().status === 'closed',
            }}
          />
        }
      >
        <GitMerge aria-hidden="true" class="size-3.5 text-note" />
      </Show>
      <span class="min-w-0 flex-1 truncate text-left">{label()}</span>
      <Show when={count('additions') != null}>
        <span
          class="shrink-0 font-mono tabular-nums text-success"
          aria-label={`${count('additions')} lines added`}
        >
          +{count('additions')}
        </span>
      </Show>
      <Show when={count('deletions') != null}>
        <span
          class="shrink-0 font-mono tabular-nums text-failure"
          aria-label={`${count('deletions')} lines deleted`}
        >
          −{count('deletions')}
        </span>
      </Show>
    </>
  );
  return (
    <Show
      when={entity()}
      fallback={
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer"
          aria-label={label()}
          class={buttonClasses({
            variant: 'plain',
            size: 'sm',
            fullWidth: true,
            noTouchResize: true,
            class: 'h-8 min-w-0 justify-start rounded-lg bg-hover p-2',
          })}
          data-magic-chip-pull-request={props.url}
          on:click={(event) => event.stopPropagation()}
        >
          {content()}
        </a>
      }
    >
      {(pr) => (
        <Button
          variant="plain"
          size="sm"
          fullWidth
          noTouchResize
          class="h-8 min-w-0 justify-start rounded-lg bg-hover p-2"
          aria-label={label()}
          data-magic-chip-pull-request={props.url}
          on:click={(event) => {
            event.stopPropagation();
            layout.openWithSplit(
              { type: 'pr', id: pr().id },
              { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
            );
          }}
        >
          {content()}
        </Button>
      )}
    </Show>
  );
};
