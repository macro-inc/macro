/**
 * Compact header chips for the session's GitHub repository and, when one
 * exists, its linked pull request. The PR folds into the same chip as the
 * repository — `#N` plus status — and opens the PR entity once GitHub has
 * synced it. Cloud runtimes can report the URL before the webhook entity
 * exists; until then this is a GitHub link with the same face.
 */

import { GithubPullRequestStatusIcon } from '@app/features/block-pr/side-panel/github-pull-request';
import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HoverCard } from '@core/component/HoverCard';
import { PullRequestPreviewCard } from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import GithubIcon from '@phosphor/github-logo.svg';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cn, Layer } from '@ui';
import {
  type Accessor,
  createMemo,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function pullRequestStatus(entity: ForeignEntity | undefined): string {
  if (!entity || entity.foreignEntitySource !== 'github_pull_request') {
    return 'open';
  }
  return optionalString(metadataRecord(entity.metadata).status) ?? 'open';
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
  status: string;
  number?: number;
  title?: string;
  repository?: string;
}): JSX.Element {
  const pullRequest = () =>
    props.number != null ? `#${props.number}` : 'Pull request';

  return (
    <>
      <GithubPullRequestStatusIcon
        status={props.status}
        class="size-3 shrink-0"
      />
      <Show when={props.repository}>
        {(repository) => (
          <span class="min-w-0 truncate" title={repository()}>
            {repository()}
          </span>
        )}
      </Show>
      <span
        class="min-w-0 shrink-0 tabular-nums"
        title={props.title ?? pullRequest()}
      >
        {pullRequest()}
      </span>
      <span class={cn('shrink-0', statusTextClass(props.status))}>
        {capitalize(props.status)}
      </span>
    </>
  );
}

/** Shared pill chrome for the GitHub fallback and the entity button. */
function ChipShell(props: ParentProps): JSX.Element {
  return (
    <span class="inline-flex h-7 max-w-60 min-w-0 items-center gap-1 rounded-full border border-edge-muted bg-surface px-2 text-xs leading-none text-ink-muted hover:bg-hover hover:text-ink">
      {props.children}
    </span>
  );
}

/** `https://github.com/org/repo.git` → `org/repo` for a compact chip. */
export function githubRepositoryLabel(url: string): string {
  const pullRequest = parseGithubPrUrl(url);
  if (pullRequest) return `${pullRequest.owner}/${pullRequest.repo}`;
  const path = url
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  const repo = path.at(-1);
  const owner = path.at(-2);
  return owner && repo && !owner.includes(':')
    ? `${owner}/${repo}`
    : (repo ?? url);
}

function githubRepositoryUrl(url: string): string {
  const pullRequest = parseGithubPrUrl(url);
  if (pullRequest)
    return `https://github.com/${pullRequest.owner}/${pullRequest.repo}`;
  return url.replace(/\.git$/i, '').replace(/\/+$/, '');
}

function GithubFallback(props: {
  url: string;
  number?: number;
  repository?: string;
}): JSX.Element {
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      data-agent-pull-request={props.url}
      title={
        props.repository && props.number != null
          ? `Open ${props.repository} #${props.number} on GitHub`
          : props.number != null
            ? `Open #${props.number} on GitHub`
            : 'Open pull request on GitHub'
      }
      onClick={(event) => event.stopPropagation()}
    >
      <ChipShell>
        <ChipFace
          status="open"
          number={props.number}
          repository={props.repository}
        />
      </ChipShell>
    </a>
  );
}

function EntityChip(props: {
  entity: ForeignEntity;
  number?: number;
  repository?: string;
}): JSX.Element {
  const { openWithSplit } = useSplitLayout();
  const status = () => pullRequestStatus(props.entity);
  const title = () => pullRequestTitle(props.entity);
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    openWithSplit(
      { type: 'pr', id: props.entity.id },
      { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
    );
  };
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>(open);

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
            (props.repository && props.number != null
              ? `Open ${props.repository} #${props.number}`
              : props.number != null
                ? `Open #${props.number}`
                : 'Open pull request')
          }
          {...navHandlers}
        >
          <ChipShell>
            <ChipFace
              status={status()}
              number={props.number}
              title={title()}
              repository={props.repository}
            />
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

/** Leading list icon, with the same PR status as the chip. */
export function AgentPullRequestIcon(props: { url: string }): JSX.Element {
  const { entity } = useLinkedPullRequest(() => props.url);
  return (
    <GithubPullRequestStatusIcon
      status={pullRequestStatus(entity())}
      class="size-4"
    />
  );
}

export function AgentPullRequestChip(props: {
  url: string;
  repository?: string;
}): JSX.Element {
  const { reference, entity } = useLinkedPullRequest(() => props.url);

  return (
    <Layer depth={2}>
      <Show
        when={entity()}
        fallback={
          <GithubFallback
            url={props.url}
            number={reference()?.number}
            repository={props.repository}
          />
        }
      >
        {(synced) => (
          <EntityChip
            entity={synced()}
            number={reference()?.number}
            repository={props.repository}
          />
        )}
      </Show>
    </Layer>
  );
}

function RepositoryChip(props: { url: string }): JSX.Element {
  const label = () => githubRepositoryLabel(props.url);
  const href = () => githubRepositoryUrl(props.url);
  return (
    <Layer depth={2}>
      <a
        href={href()}
        target="_blank"
        rel="noreferrer"
        data-agent-repository={props.url}
        title={`Open ${label()} on GitHub`}
        aria-label={`Open ${label()} on GitHub`}
        onClick={(event) => event.stopPropagation()}
      >
        <ChipShell>
          <GithubIcon class="size-3 shrink-0" />
          <span class="min-w-0 truncate">{label()}</span>
        </ChipShell>
      </a>
    </Layer>
  );
}

/**
 * Header chip for the session's repository. A linked pull request folds into
 * the same chip — the PR is the more specific place to go.
 */
export function AgentGithubChip(props: {
  repoUrl?: string;
  pullRequestUrl?: string;
}): JSX.Element {
  const repository = () =>
    props.repoUrl
      ? githubRepositoryLabel(props.repoUrl)
      : props.pullRequestUrl
        ? githubRepositoryLabel(props.pullRequestUrl)
        : undefined;

  return (
    <Show
      when={props.pullRequestUrl}
      fallback={
        <Show when={props.repoUrl}>
          {(url) => <RepositoryChip url={url()} />}
        </Show>
      }
    >
      {(url) => <AgentPullRequestChip url={url()} repository={repository()} />}
    </Show>
  );
}
