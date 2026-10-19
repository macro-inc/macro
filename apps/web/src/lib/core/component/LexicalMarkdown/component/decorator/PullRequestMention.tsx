import {
  parseGithubPrUrl,
  prDisplayName,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HoverCard } from '@core/component/HoverCard';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { openExternalUrl } from '@core/util/url';
import {
  useNativeSplitNavigationHandler,
  useSplitNavigationHandler,
} from '@core/util/useSplitNavigationHandler';
import {
  $isPullRequestMentionNode,
  HISTORIC_TAG,
  isGithubPullRequestUrl,
  type PullRequestMentionDecoratorProps,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from '@macro-inc/lexical-core';
import OpenIcon from '@phosphor/arrows-out.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { useGithubLinkStatusQuery } from '@queries/auth/github-link';
import { queryReadyGate } from '@queries/gate';
import {
  usePrMentionQuery,
  usePullRequestByGithubKeyQuery,
} from '@queries/storage/pr-mention';
import type {
  ForeignEntity,
  GithubPullRequestCheckRun,
  GithubPullRequestComment,
} from '@service-storage/generated/schemas';
import { cn, Surface } from '@ui';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  type JSX,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister } from '../../plugins';
import { MentionTooltip } from './MentionTooltip';

const GITHUB_PULL_REQUEST_SOURCE = 'github_pull_request';
const STATUS_ICON_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function displayNameFromGithubKey(key: string): string | undefined {
  const match = key.match(
    /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9][0-9]*)$/
  );
  if (!match) return undefined;
  return `${match[1]}/${match[2]}#${match[3]}`;
}

function pullRequestLabel(
  entity: ForeignEntity | undefined
): string | undefined {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return undefined;
  }

  const metadata = metadataRecord(entity.metadata);
  const title = optionalString(metadata.name);
  const displayName = optionalString(metadata.displayName);
  const owner = optionalString(metadata.owner);
  const repo = optionalString(metadata.repo);
  const number = optionalNumber(metadata.number);
  const refLabel =
    owner && repo && number != null
      ? `${owner}/${repo}#${number}`
      : displayNameFromGithubKey(entity.foreignEntityId);

  if (title && refLabel) return `${refLabel} ${title}`;
  return title ?? displayName ?? refLabel;
}

function pullRequestUrl(entity: ForeignEntity | undefined): string | undefined {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return undefined;
  }
  const url = optionalString(metadataRecord(entity.metadata).url);
  return url && isGithubPullRequestUrl(url) ? url : undefined;
}

function pullRequestStatus(entity: ForeignEntity | undefined): string {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return 'open';
  }
  return optionalString(metadataRecord(entity.metadata).status) ?? 'open';
}

interface PullRequestParts {
  name: string;
  number?: string;
}

/** The `owner/repo#N title` label `pullRequestLabel` writes to the node. */
const RESOLVED_LABEL_PATTERN =
  /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#([1-9][0-9]*) (.+)$/;

/**
 * Split a stored label into the face a resolved PR shows, so a mention whose
 * label already names the PR renders the same text before and after its
 * lookup settles.
 */
function labelParts(label: string | undefined): PullRequestParts {
  const match = label?.match(RESOLVED_LABEL_PATTERN);
  if (match) return { name: match[2], number: `#${match[1]}` };
  return { name: fallbackLabel(label) };
}

function pullRequestParts(
  entity: ForeignEntity | undefined,
  label: string | undefined
): PullRequestParts {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return labelParts(label);
  }

  const metadata = metadataRecord(entity.metadata);
  const title = optionalString(metadata.name);
  const displayName = optionalString(metadata.displayName);
  const number = optionalNumber(metadata.number);
  const ref =
    number != null
      ? `#${number}`
      : displayNameFromGithubKey(entity.foreignEntityId);
  const name = title ?? displayName ?? ref ?? fallbackLabel(label);

  return { name, number: name === ref ? undefined : ref };
}

function fallbackLabel(label: string | undefined): string {
  return label || 'Pull request';
}

function PullRequestStatusIcon(props: { status: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn(
            'size-full',
            STATUS_ICON_CLASS[props.status] ?? 'text-ink-muted'
          )}
        />
      }
    >
      <GitMerge class="size-full text-note" />
    </Show>
  );
}

const STATUS_PILL_CLASS: Record<string, string> = {
  open: 'bg-success/15 text-success',
  merged: 'bg-note/15 text-note',
  closed: 'bg-failure/15 text-failure',
};

interface ChecksSummary {
  passed: number;
  failed: number;
  total: number;
}

interface PullRequestPreview {
  title: string;
  ref?: string;
  url?: string;
  status: string;
  additions?: number;
  deletions?: number;
  commentCount?: number;
  checks?: ChecksSummary;
}

function checksSummary(
  checks: GithubPullRequestCheckRun[] | undefined
): ChecksSummary | undefined {
  if (!checks || checks.length === 0) return undefined;
  let passed = 0;
  let failed = 0;
  for (const run of checks) {
    const conclusion = optionalString(run.conclusion)?.toLowerCase();
    if (conclusion === 'success') passed += 1;
    else if (
      conclusion === 'failure' ||
      conclusion === 'timed_out' ||
      conclusion === 'cancelled' ||
      conclusion === 'action_required'
    ) {
      failed += 1;
    }
  }
  return { passed, failed, total: checks.length };
}

function pullRequestPreview(
  entity: ForeignEntity | undefined,
  label: string | undefined
): PullRequestPreview | undefined {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return undefined;
  }

  const metadata = metadataRecord(entity.metadata);
  const title = optionalString(metadata.name);
  const displayName = optionalString(metadata.displayName);
  const owner = optionalString(metadata.owner);
  const repo = optionalString(metadata.repo);
  const number = optionalNumber(metadata.number);
  const ref =
    owner && repo && number != null
      ? `${owner}/${repo}#${number}`
      : displayNameFromGithubKey(entity.foreignEntityId);
  const comments = Array.isArray(metadata.comments)
    ? (metadata.comments as GithubPullRequestComment[])
    : undefined;
  const checks = Array.isArray(metadata.checks)
    ? (metadata.checks as GithubPullRequestCheckRun[])
    : undefined;

  return {
    title: title ?? displayName ?? ref ?? fallbackLabel(label),
    ref,
    url: optionalString(metadata.url),
    status: optionalString(metadata.status) ?? 'open',
    additions: optionalNumber(metadata.additions),
    deletions: optionalNumber(metadata.deletions),
    commentCount: comments?.length || undefined,
    checks: checksSummary(checks),
  };
}

function PreviewStat(props: { children: JSX.Element; class?: string }) {
  return (
    <span class={cn('flex items-center gap-1 font-mono', props.class)}>
      {props.children}
    </span>
  );
}

function PullRequestPreviewBody(props: { id: string; fallbackLabel?: string }) {
  const query = usePrMentionQuery(() => props.id);
  const preview = createMemo(() =>
    pullRequestPreview(query.data, props.fallbackLabel)
  );

  return (
    <Show
      when={preview()}
      fallback={
        <div class="p-3 text-sm text-ink-muted">
          {fallbackLabel(props.fallbackLabel)}
        </div>
      }
    >
      {(pr) => (
        <div class="w-full flex flex-col">
          <div class="flex items-center justify-between gap-2 p-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="relative size-4 shrink-0 inline-flex">
                <PullRequestStatusIcon status={pr().status} />
              </span>
              <Show when={pr().ref}>
                {(ref) => (
                  <span class="text-[0.8em] text-ink-muted font-mono truncate">
                    {ref()}
                  </span>
                )}
              </Show>
              <span
                class={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-xxs font-medium uppercase tracking-wide',
                  STATUS_PILL_CLASS[pr().status] ?? 'bg-edge text-ink-muted'
                )}
              >
                {pr().status}
              </span>
            </div>
            <Show when={pr().url}>
              {(url) => (
                <a
                  href={url()}
                  target="_blank"
                  rel="noreferrer"
                  class="shrink-0 text-link hover:text-link-hover visited:text-link-visited"
                  onClick={(e) => e.stopPropagation()}
                >
                  <OpenIcon class="size-4" />
                </a>
              )}
            </Show>
          </div>

          <div class="line-clamp-2 wrap-break-word px-2 mb-2 text-sm font-semibold select-text">
            {pr().title}
          </div>

          <Show
            when={
              pr().additions != null ||
              pr().deletions != null ||
              pr().commentCount ||
              pr().checks
            }
          >
            <div class="p-2 border-t border-edge-muted flex items-center gap-3 text-xs text-ink-muted">
              <Show when={pr().additions != null || pr().deletions != null}>
                <PreviewStat>
                  <Show when={pr().additions != null}>
                    <span class="text-success">{`+${pr().additions}`}</span>
                  </Show>
                  <Show when={pr().deletions != null}>
                    <span class="text-failure">{`-${pr().deletions}`}</span>
                  </Show>
                </PreviewStat>
              </Show>

              <Show when={pr().commentCount}>
                {(count) => (
                  <PreviewStat>
                    <ChatCircle class="size-3.5" />
                    {count()}
                  </PreviewStat>
                )}
              </Show>

              <Show when={pr().checks}>
                {(checks) => (
                  <PreviewStat class="ml-auto">
                    <Show when={checks().passed}>
                      <span class="text-success">{`${checks().passed} passed`}</span>
                    </Show>
                    <Show when={checks().failed}>
                      <span class="text-failure">{`${checks().failed} failed`}</span>
                    </Show>
                  </PreviewStat>
                )}
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function PullRequestPreviewCard(props: {
  id: string;
  fallbackLabel?: string;
}) {
  return (
    <div class="select-none w-80 text-ink">
      <Surface depth={3} class="glass bg-menu-glass rounded-xl">
        <Suspense
          fallback={
            <div class="p-3 flex items-center justify-center text-sm text-ink-muted">
              Fetching PR...
            </div>
          }
        >
          <PullRequestPreviewBody
            id={props.id}
            fallbackLabel={props.fallbackLabel}
          />
        </Suspense>
      </Surface>
    </div>
  );
}

function githubKeyFromUrl(url: string | undefined): string | undefined {
  const ref = url ? parseGithubPrUrl(url) : null;
  return ref ? toGithubKey(ref) : undefined;
}

/** The label to show before a mention's entity resolves. */
function mentionFallbackLabel(
  props: Pick<PullRequestMentionDecoratorProps, 'label' | 'url'>
): string | undefined {
  if (props.label) return props.label;
  const ref = props.url ? parseGithubPrUrl(props.url) : null;
  return ref ? prDisplayName(ref) : undefined;
}

/**
 * Resolve a GitHub-URL-only mention (one an agent wrote without the Macro id)
 * to its synced pull request. Settles to `undefined` while loading and when
 * Macro has not synced the PR, without suspending.
 */
function useGithubUrlMentionEntity(
  props: Pick<PullRequestMentionDecoratorProps, 'id' | 'url'>,
  enabled: Accessor<boolean>
): Accessor<ForeignEntity | undefined> {
  const query = usePullRequestByGithubKeyQuery(
    () => (props.id ? undefined : githubKeyFromUrl(props.url)),
    enabled
  );
  return () => (query.isSuccess ? (query.data ?? undefined) : undefined);
}

/** Hover preview for a GitHub URL mention Macro has not synced. */
function UnsyncedPullRequestPreviewCard(props: {
  label: string;
  url?: string;
}) {
  return (
    <div class="select-none w-80 text-ink">
      <Surface depth={3} class="glass bg-menu-glass rounded-xl">
        <div class="flex items-center justify-between gap-2 p-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="relative size-4 shrink-0 inline-flex">
              <PullRequestStatusIcon status="unknown" />
            </span>
            <span class="text-sm font-semibold truncate">{props.label}</span>
          </div>
          <Show when={props.url}>
            {(url) => (
              <a
                href={url()}
                target="_blank"
                rel="noreferrer"
                class="shrink-0 text-link hover:text-link-hover visited:text-link-visited"
                onClick={(e) => e.stopPropagation()}
              >
                <OpenIcon class="size-4" />
              </a>
            )}
          </Show>
        </div>
      </Surface>
    </div>
  );
}

function PullRequestMentionContent(props: PullRequestMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const fetchEnabled = () => !lexicalWrapper?.skipPreviewFetch;

  const query = usePrMentionQuery(() => props.id, fetchEnabled);
  const urlEntity = useGithubUrlMentionEntity(props, fetchEnabled);
  const entity = () => {
    if (!props.id) return urlEntity();
    return query.isSuccess ? query.data : undefined;
  };

  const label = createMemo(
    () =>
      pullRequestLabel(entity()) ?? fallbackLabel(mentionFallbackLabel(props))
  );
  const parts = createMemo(() =>
    pullRequestParts(entity(), mentionFallbackLabel(props))
  );
  // An unresolved mention has no known state yet.
  const status = createMemo(() => {
    const resolved = entity();
    return resolved ? pullRequestStatus(resolved) : 'unknown';
  });

  // Keep the node's label and GitHub URL current, so the Markdown this editor
  // sends (an agent prompt, a message) names the PR and links it.
  createEffect(() => {
    const resolved = entity();
    const nextLabel = pullRequestLabel(resolved);
    const nextUrl = props.url ? undefined : pullRequestUrl(resolved);
    const labelChanged = !!nextLabel && nextLabel !== props.label;
    if (!editor || (!labelChanged && !nextUrl)) return;

    editor.update(
      () => {
        const node = $getNodeByKey(props.key);
        if ($isPullRequestMentionNode(node)) {
          if (labelChanged) node.setLabel(nextLabel);
          if (nextUrl) node.setUrl(nextUrl);
        }
      },
      {
        tag: [HISTORIC_TAG, SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG],
        discrete: true,
      }
    );
  });

  // A sent message must not change height when the PR resolves after it
  // mounts: the face stays on one line, and one whose markup lacks the title
  // (an agent's URL-only mention) takes the full width the title will fill.
  const reservesTitleWidth = () =>
    !labelParts(mentionFallbackLabel(props)).number;

  return (
    <span
      data-pr-mention="true"
      data-pr-id={props.id}
      data-pr-label={label()}
      class={cn(
        'pointer-events-auto inline-flex max-w-[min(32em,100%)] items-baseline',
        reservesTitleWidth() && 'w-[32em]'
      )}
    >
      <span class="relative top-[0.125em] size-[1em] shrink-0 inline-flex mx-1">
        <PullRequestStatusIcon status={status()} />
      </span>
      <span class="flex min-w-0 items-baseline underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        <span class="min-w-0 truncate">{parts().name}</span>
        <Show when={parts().number}>
          {(number) => (
            <span class="shrink-0 whitespace-pre text-ink-extra-muted text-[0.8em]">{` ${number()}`}</span>
          )}
        </Show>
      </span>
    </span>
  );
}

export function PullRequestMention(props: PullRequestMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;
  const { openWithSplit } = useSplitLayout()!;

  const githubLinkQuery = useGithubLinkStatusQuery({
    enabled: () => !lexicalWrapper?.skipPreviewFetch,
  });

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const urlEntity = useGithubUrlMentionEntity(
    props,
    () => !lexicalWrapper?.skipPreviewFetch
  );
  const entityId = () => props.id || urlEntity()?.id;

  // When GitHub is not linked, render as a plain link instead of the fancy mention UI
  const shouldRenderAsPlainLink = () => {
    if (lexicalWrapper?.skipPreviewFetch) return false;
    // A failed query is still "fetched" while its next mount retries it.
    // Reading its pending data would suspend the surrounding composer/message.
    return !!(
      props.url &&
      queryReadyGate(githubLinkQuery) &&
      githubLinkQuery.data.status !== 'linked'
    );
  };

  const open = (e: MouseEvent | KeyboardEvent | null) => {
    // Match the rendered plain-link destination: Enter must not open the
    // internal PR split when GitHub is unlinked, even if props.id is set.
    if (shouldRenderAsPlainLink()) {
      openExternalUrl(props.url!);
      return;
    }
    const id = entityId();
    if (!id) {
      // A PR Macro has not synced has no split to open; fall back to GitHub.
      if (props.url) openExternalUrl(props.url);
      return;
    }
    openWithSplit(
      { type: 'pr', id },
      { preferNewSplit: openInNewSplitForMention(e?.shiftKey, e != null) }
    );
  };

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          if (isSelectedAsNode()) {
            open(e);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  const navHandlers = useNativeSplitNavigationHandler<HTMLSpanElement>((e) => {
    e.stopPropagation();
    open(e);
  });

  return (
    <Show
      when={!shouldRenderAsPlainLink()}
      fallback={
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer"
          class="text-link hover:text-link-hover visited:text-link-visited underline"
        >
          {fallbackLabel(mentionFallbackLabel(props))}
        </a>
      }
    >
      <HoverCard
        trigger={
          <span class="relative">
            <span
              class={cn(
                'size-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active',
                isSelectedAsNode() && 'bg-active text-ink'
              )}
              {...navHandlers}
            >
              <PullRequestMentionContent {...props} />
            </span>
            <MentionTooltip show={isSelectedAsNode()} text="Open" />
          </span>
        }
        content={
          <Show
            when={entityId()}
            fallback={
              <UnsyncedPullRequestPreviewCard
                label={fallbackLabel(mentionFallbackLabel(props))}
                url={props.url}
              />
            }
          >
            {(id) => (
              <PullRequestPreviewCard
                id={id()}
                fallbackLabel={mentionFallbackLabel(props)}
              />
            )}
          </Show>
        }
      />
    </Show>
  );
}

/**
 * The mention's face for a pull request already in hand, outside any
 * editor: the status icon and `title #N` pill with the same hover preview,
 * opening the PR split on click. For surfaces that resolve the entity
 * themselves - a Magic Chip linking the PR its session opened - rather than
 * carrying a mention node.
 */
export function PullRequestEntityLink(props: {
  entity: ForeignEntity;
  class?: string;
}) {
  const { openWithSplit } = useSplitLayout()!;
  const parts = createMemo(() => pullRequestParts(props.entity, undefined));
  const status = createMemo(() => pullRequestStatus(props.entity));
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    openWithSplit(
      { type: 'pr', id: props.entity.id },
      { preferNewSplit: openInNewSplitForMention(e.shiftKey, true) }
    );
  };
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>(open);

  return (
    <HoverCard
      triggerClass="min-w-0 max-w-full"
      trigger={
        <button
          type="button"
          class={cn(
            'inline-flex min-w-0 items-center gap-1 rounded-xs px-1 py-0.5 hover:bg-hover focus:bg-active',
            props.class
          )}
          data-pr-entity-link={props.entity.id}
          {...navHandlers}
        >
          <span class="relative size-[1em] shrink-0 inline-flex">
            <PullRequestStatusIcon status={status()} />
          </span>
          <span class="min-w-0 truncate">{parts().name}</span>
          <Show when={parts().number}>
            {(number) => (
              <span class="shrink-0 text-ink-extra-muted text-[0.8em]">
                {number()}
              </span>
            )}
          </Show>
        </button>
      }
      content={<PullRequestPreviewCard id={props.entity.id} />}
    />
  );
}
