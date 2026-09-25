/**
 * Compact header chip for the session's linked pull request: `#N` plus
 * status, opening the PR entity once GitHub has synced it. Cloud runtimes
 * can report the URL before the webhook entity exists; until then this is
 * a GitHub link with the same face.
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
}): JSX.Element {
  const label = () =>
    props.number != null ? `#${props.number}` : 'Pull request';

  return (
    <>
      <GithubPullRequestStatusIcon
        status={props.status}
        class="size-3 shrink-0"
      />
      <span
        class="min-w-0 truncate tabular-nums"
        title={props.title ?? label()}
      >
        {label()}
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
    <span class="inline-flex h-7 max-w-44 min-w-0 items-center gap-1 rounded-full border border-edge-muted bg-surface px-2 text-xs leading-none text-ink-muted hover:bg-hover hover:text-ink">
      {props.children}
    </span>
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
        <ChipFace status="open" number={props.number} />
      </ChipShell>
    </a>
  );
}

function EntityChip(props: {
  entity: ForeignEntity;
  number?: number;
}): JSX.Element {
  const { openWithSplit } = useSplitLayout();
  const status = () => pullRequestStatus(props.entity);
  const title = () => pullRequestTitle(props.entity);
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) =>
    openPullRequestEntity(openWithSplit, props.entity.id, event)
  );

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

function openPullRequestEntity(
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'],
  entityId: string,
  event: MouseEvent | KeyboardEvent
) {
  event.stopPropagation();
  openWithSplit(
    { type: 'pr', id: entityId },
    { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
  );
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
          <EntityChip entity={synced()} number={reference()?.number} />
        )}
      </Show>
    </Layer>
  );
}
