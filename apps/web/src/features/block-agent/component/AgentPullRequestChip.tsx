/**
 * Compact header chip for the session's linked pull request: `#N` plus
 * status, opening the PR on GitHub. Once GitHub has synced the PR the chip
 * follows its status and previews it on hover. Cloud runtimes can report the
 * URL before the webhook entity exists, and some stacks never sync it; until
 * then the status is unknown, so the chip is a GitHub link showing only `#N`
 * with a neutral icon, never a guessed status.
 */

import { GithubPullRequestStatusIcon } from '@app/features/block-pr/side-panel/github-pull-request';
import { pullRequestGithubUrl } from '@app/features/block-pr/util/pr-github-url';
import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { HoverCard } from '@core/component/HoverCard';
import { PullRequestPreviewCard } from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { openExternalUrl } from '@core/util/url';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import GitPullRequest from '@icon/system/regular/git-pull-request.svg';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cn, Layer } from '@ui';
import { type Accessor, createMemo, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ChipShell } from './AgentSessionChipShell';

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** The PR's status from its synced entity, or `undefined` when unknown. */
function pullRequestStatus(entity: ForeignEntity): string | undefined {
  if (entity.foreignEntitySource !== 'github_pull_request') return undefined;
  return optionalString(metadataRecord(entity.metadata).status);
}

function pullRequestTitle(
  entity: ForeignEntity | undefined
): string | undefined {
  if (!entity || entity.foreignEntitySource !== 'github_pull_request') {
    return undefined;
  }
  return optionalString(metadataRecord(entity.metadata).name);
}

function statusTextClass(status: string): string {
  return match(status)
    .with('merged', () => 'text-note')
    .with('closed', () => 'text-failure')
    .otherwise(() => 'text-success');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ChipFace(props: {
  status?: string;
  number?: number;
  title?: string;
}): JSX.Element {
  const label = () =>
    props.number != null ? `#${props.number}` : 'Pull request';

  return (
    <>
      <Show
        when={props.status}
        fallback={<GitPullRequest class="size-3 shrink-0 text-ink-muted" />}
      >
        {(status) => (
          <GithubPullRequestStatusIcon
            status={status()}
            class="size-3 shrink-0"
          />
        )}
      </Show>
      <span
        class="min-w-0 truncate tabular-nums"
        title={props.title ?? label()}
      >
        {label()}
      </span>
      <Show when={props.status}>
        {(status) => (
          <span class={cn('shrink-0', statusTextClass(status()))}>
            {capitalize(status())}
          </span>
        )}
      </Show>
    </>
  );
}

function GithubFallback(props: { url: string; number?: number }): JSX.Element {
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      data-agent-pull-request={props.url}
      title={
        props.number != null
          ? `Open #${props.number} on GitHub`
          : 'Open pull request on GitHub'
      }
      onClick={(event) => event.stopPropagation()}
    >
      <ChipShell>
        <ChipFace number={props.number} />
      </ChipShell>
    </a>
  );
}

function EntityChip(props: {
  entity: ForeignEntity;
  url: string;
  number?: number;
}): JSX.Element {
  const status = () => pullRequestStatus(props.entity);
  const title = () => pullRequestTitle(props.entity);
  // PRs open on GitHub for now, not in the PR split.
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    event.stopPropagation();
    openExternalUrl(pullRequestGithubUrl(props.entity) ?? props.url);
  });

  return (
    <HoverCard
      triggerClass="min-w-0 max-w-full"
      trigger={
        <button
          type="button"
          data-agent-pull-request={props.entity.id}
          data-pr-entity-link={props.entity.id}
          title={
            title() ??
            (props.number != null
              ? `Open #${props.number}`
              : 'Open pull request')
          }
          {...navHandlers}
        >
          <ChipShell>
            <ChipFace status={status()} number={props.number} title={title()} />
          </ChipShell>
        </button>
      }
      content={<PullRequestPreviewCard id={props.entity.id} />}
    />
  );
}

function useLinkedPullRequest(url: Accessor<string>) {
  const reference = createMemo(() => parseGithubPrUrl(url()));
  const githubKey = createMemo(() => {
    const parsed = reference();
    return parsed ? toGithubKey(parsed) : undefined;
  });
  const query = usePullRequestByGithubKeyQuery(githubKey);
  const entity = () =>
    query.isSuccess ? (query.data ?? undefined) : undefined;
  return { reference, entity };
}

export function AgentPullRequestChip(props: { url: string }): JSX.Element {
  const { reference, entity } = useLinkedPullRequest(() => props.url);

  return (
    <Layer depth={2}>
      <Show
        when={entity()}
        fallback={
          <GithubFallback url={props.url} number={reference()?.number} />
        }
      >
        {(synced) => (
          <EntityChip
            entity={synced()}
            url={props.url}
            number={reference()?.number}
          />
        )}
      </Show>
    </Layer>
  );
}
