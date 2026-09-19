import {
  parseGithubPrUrl,
  prDisplayName,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { PullRequestEntityLink } from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { type Component, createMemo, Show } from 'solid-js';

/**
 * The pull request a session opened, in the chip's header: our GitHub PR
 * entity once the webhook has synced it, a plain link to GitHub until then.
 * Cloud runtimes can report the URL before the GitHub webhook entity exists.
 * Connection gateway supplies the saved entity and subsequent status changes.
 */
export const MagicChipPullRequest: Component<{ url: string }> = (props) => {
  const reference = createMemo(() => parseGithubPrUrl(props.url));
  const githubKey = createMemo(() => {
    const parsed = reference();
    return parsed ? toGithubKey(parsed) : undefined;
  });
  const query = usePullRequestByGithubKeyQuery(githubKey);

  const entity = () => (query.isSuccess ? query.data : undefined);

  return (
    <Show
      when={entity()}
      fallback={
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer"
          title={reference() ? prDisplayName(reference()!) : 'Pull request'}
          class="inline-flex min-w-0 max-w-full items-center gap-1 rounded-xs px-1 py-0.5 text-ink-muted hover:bg-hover hover:text-ink"
          data-magic-chip-pull-request={props.url}
          onClick={(event) => event.stopPropagation()}
        >
          <GitPullRequest class="size-[1em] shrink-0 text-success" />
          <span class="truncate">
            {reference() ? prDisplayName(reference()!) : 'Pull request'}
          </span>
        </a>
      }
    >
      {(entity) => (
        <PullRequestEntityLink
          entity={entity()}
          class="max-w-full text-ink-muted hover:text-ink"
        />
      )}
    </Show>
  );
};
