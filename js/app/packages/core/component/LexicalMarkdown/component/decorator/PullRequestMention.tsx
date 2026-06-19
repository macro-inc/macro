import { useSplitLayout } from '@app/component/split-layout/layout';
import { HoverCard } from '@core/component/HoverCard';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  $isPullRequestMentionNode,
  type PullRequestMentionDecoratorProps,
} from '@lexical-core';
import OpenIcon from '@phosphor/arrows-out.svg';
import ChatCircle from '@phosphor/chat-circle.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { usePrMentionQuery } from '@queries/storage/pr-mention';
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

function pullRequestParts(
  entity: ForeignEntity | undefined,
  props: PullRequestMentionDecoratorProps
): PullRequestParts {
  if (!entity || entity.foreignEntitySource !== GITHUB_PULL_REQUEST_SOURCE) {
    return { name: fallbackLabel(props) };
  }

  const metadata = metadataRecord(entity.metadata);
  const title = optionalString(metadata.name);
  const displayName = optionalString(metadata.displayName);
  const number = optionalNumber(metadata.number);
  const ref =
    number != null
      ? `#${number}`
      : displayNameFromGithubKey(entity.foreignEntityId);
  const name = title ?? displayName ?? ref ?? fallbackLabel(props);

  return { name, number: name === ref ? undefined : ref };
}

function fallbackLabel(props: PullRequestMentionDecoratorProps): string {
  return props.label || 'Pull request';
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
  props: PullRequestMentionDecoratorProps
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
    title: title ?? displayName ?? ref ?? fallbackLabel(props),
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

function PullRequestPreviewBody(props: {
  id: string;
  fallbackProps: PullRequestMentionDecoratorProps;
}) {
  const query = usePrMentionQuery(() => props.id);
  const preview = createMemo(() =>
    pullRequestPreview(query.data, props.fallbackProps)
  );

  return (
    <Show
      when={preview()}
      fallback={
        <div class="p-3 text-sm text-ink-muted">
          {fallbackLabel(props.fallbackProps)}
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
                  class="shrink-0 text-ink-muted hover:text-ink"
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

function PullRequestPreviewCard(props: {
  id: string;
  fallbackProps: PullRequestMentionDecoratorProps;
}) {
  return (
    <div class="select-none overflow-hidden w-80 text-ink">
      <Surface active depth={3} class="rounded-xl shadow-lg shadow-drop-shadow">
        <Suspense
          fallback={
            <div class="p-3 flex items-center justify-center text-sm text-ink-muted">
              Fetching PR...
            </div>
          }
        >
          <PullRequestPreviewBody
            id={props.id}
            fallbackProps={props.fallbackProps}
          />
        </Suspense>
      </Surface>
    </div>
  );
}

function PullRequestMentionContent(props: PullRequestMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;

  const query = usePrMentionQuery(
    () => props.id,
    () => !lexicalWrapper?.skipPreviewFetch
  );

  const label = createMemo(
    () => pullRequestLabel(query.data) ?? fallbackLabel(props)
  );
  const parts = createMemo(() => pullRequestParts(query.data, props));
  const status = createMemo(() => pullRequestStatus(query.data));

  createEffect(() => {
    const nextLabel = pullRequestLabel(query.data);
    if (!editor || !nextLabel || nextLabel === props.label) return;

    editor.update(
      () => {
        const node = $getNodeByKey(props.key);
        if ($isPullRequestMentionNode(node)) {
          node.setLabel(nextLabel);
        }
      },
      { tag: 'historic', discrete: true }
    );
  });

  return (
    <span
      data-pr-mention="true"
      data-pr-id={props.id}
      data-pr-label={label()}
      class="pointer-events-auto"
    >
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        <PullRequestStatusIcon status={status()} />
      </span>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {parts().name}
        <Show when={parts().number}>
          {(number) => (
            <span class="text-ink-extra-muted text-[0.8em]">{` ${number()}`}</span>
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

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const open = (e: MouseEvent | KeyboardEvent | null) => {
    openWithSplit(
      { type: 'pr', id: props.id },
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

  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>((e) => {
    e.stopPropagation();
    open(e);
  });

  return (
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
            <Suspense
              fallback={
                <span class="text-ink-placeholder">Fetching PR...</span>
              }
            >
              <PullRequestMentionContent {...props} />
            </Suspense>
          </span>
          <MentionTooltip show={isSelectedAsNode()} text="Open" />
        </span>
      }
      content={<PullRequestPreviewCard id={props.id} fallbackProps={props} />}
    />
  );
}
