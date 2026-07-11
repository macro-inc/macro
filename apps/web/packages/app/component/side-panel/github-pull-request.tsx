import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import Circle from '@phosphor/circle.svg';
import CircleNotch from '@phosphor/circle-notch.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import MinusCircle from '@phosphor/minus-circle.svg';
import XCircle from '@phosphor/x-circle.svg';
import type {
  GithubPullRequest,
  GithubPullRequestCheckRun,
} from '@service-storage/generated/schemas';
import { cn, Layer } from '@ui';
import { type Accessor, For, Match, Show, Switch } from 'solid-js';
import { SidePanel } from './SidePanel';

type GithubPullRequestWithPanelDetails = GithubPullRequest & {
  authorLogin?: string | null;
};

const STATUS_ICON_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

const PR_PILL_CLASS =
  'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function githubDisplayLogin(login: string): string {
  return login.replace(/\[bot\]$/, '');
}

function githubAvatarUrl(login: string): string {
  return `https://github.com/${githubDisplayLogin(login)}.png?size=48`;
}

function checksPassedCount(checks: GithubPullRequestCheckRun[]): number {
  return checks.filter((check) => check.conclusion === 'success').length;
}

function checkDuration(check: GithubPullRequestCheckRun): string | null {
  if (!check.startedAt || !check.completedAt) return null;
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function GithubPullRequestCheckStatusIcon(props: {
  check: GithubPullRequestCheckRun;
}) {
  return (
    <Switch fallback={<Circle class="size-3.5 text-ink-placeholder" />}>
      <Match when={props.check.status !== 'completed'}>
        <CircleNotch class="size-3.5 text-ink-placeholder animate-spin" />
      </Match>
      <Match when={props.check.conclusion === 'success'}>
        <CheckCircle class="size-3.5 text-success" />
      </Match>
      <Match
        when={
          props.check.conclusion === 'failure' ||
          props.check.conclusion === 'timed_out'
        }
      >
        <XCircle class="size-3.5 text-failure" />
      </Match>
      <Match
        when={
          props.check.conclusion === 'skipped' ||
          props.check.conclusion === 'cancelled' ||
          props.check.conclusion === 'neutral'
        }
      >
        <MinusCircle class="size-3.5 text-ink-placeholder" />
      </Match>
    </Switch>
  );
}

export function GithubPullRequestStatusIcon(props: {
  status: string;
  class?: string;
}) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn('size-3.5', STATUS_ICON_CLASS[props.status], props.class)}
        />
      }
    >
      <GitMerge class={cn('size-3.5 text-note', props.class)} />
    </Show>
  );
}

export function GithubPullRequestStatusChip(props: {
  status: string;
  class?: string;
}) {
  return (
    <Layer depth={2}>
      <span
        class={cn(
          PR_PILL_CLASS,
          'shrink-0',
          STATUS_TEXT_CLASS[props.status],
          props.class
        )}
      >
        <GithubPullRequestStatusIcon
          status={props.status}
          class="size-3 shrink-0"
        />
        {capitalize(props.status)}
      </span>
    </Layer>
  );
}

export function GithubPullRequestDetailsContent(props: {
  enrichment: Accessor<GithubPullRequestWithPanelDetails | undefined>;
}) {
  return (
    <Show when={props.enrichment()} fallback={<SidePanel.Loading />}>
      {(enrichment) => (
        <SidePanel.Grid>
          <GithubPullRequestDetailsRows enrichment={enrichment()} />
        </SidePanel.Grid>
      )}
    </Show>
  );
}

export function GithubPullRequestDetailsRows(props: {
  enrichment: GithubPullRequestWithPanelDetails;
}) {
  return (
    <>
      <SidePanel.Row label="Author">
        <SidePanel.Pill>
          <Show
            when={props.enrichment.authorLogin}
            fallback={
              <>
                <span class="skeleton-shimmer size-3.5 rounded-full bg-ink/10" />
                <span class="skeleton-shimmer h-3 w-16 rounded-full bg-ink/10" />
              </>
            }
          >
            {(authorLogin) => (
              <>
                <img
                  src={githubAvatarUrl(authorLogin())}
                  alt={authorLogin()}
                  class="size-3.5 rounded-full shrink-0"
                  loading="lazy"
                />
                <span class="truncate">{authorLogin()}</span>
              </>
            )}
          </Show>
        </SidePanel.Pill>
      </SidePanel.Row>
      <SidePanel.Row label="Repository">
        <span class="truncate">
          {props.enrichment.owner}/{props.enrichment.repo}
        </span>
      </SidePanel.Row>
      <Show when={props.enrichment.status}>
        {(status) => (
          <SidePanel.Row label="Status">
            <GithubPullRequestStatusChip
              status={status()}
              class="text-xs px-1.5 py-0.5 gap-1"
            />
          </SidePanel.Row>
        )}
      </Show>
      <Show
        when={
          props.enrichment.additions != null ||
          props.enrichment.deletions != null
        }
      >
        <SidePanel.Row label="Changes">
          <span class="text-success">+{props.enrichment.additions ?? 0}</span>
          <span class="text-ink-extra-muted">/</span>
          <span class="text-failure">−{props.enrichment.deletions ?? 0}</span>
        </SidePanel.Row>
      </Show>
      <SidePanel.Row label="GitHub">
        <a
          href={props.enrichment.url}
          target="_blank"
          rel="noreferrer"
          class="min-w-0 truncate underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 hover:decoration-current"
        >
          {props.enrichment.displayName}
        </a>
      </SidePanel.Row>
    </>
  );
}

export function GithubPullRequestChecksContent(props: {
  enrichment: Accessor<GithubPullRequestWithPanelDetails | undefined>;
}) {
  const checks = () => props.enrichment()?.checks ?? [];
  return (
    <Show
      when={checks().length > 0}
      fallback={<div class="text-ink-placeholder">No checks</div>}
    >
      <div class="flex flex-col gap-1 text-xs">
        <div class="text-xs text-ink-muted">
          {checksPassedCount(checks())} passed
        </div>
        <For each={checks()}>
          {(check) => (
            <div class="flex items-center gap-2 min-w-0 h-6">
              <GithubPullRequestCheckStatusIcon check={check} />
              <span class="truncate">{check.name}</span>
              <span class="ml-auto flex items-center gap-1.5 shrink-0 text-ink-placeholder">
                <Show when={checkDuration(check)}>
                  {(duration) => <span>{duration()}</span>}
                </Show>
                <Show when={check.url}>
                  {(url) => (
                    <a
                      href={url()}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${check.name} on GitHub`}
                      class="hover:opacity-70 transition-opacity"
                    >
                      <ArrowSquareOut class="size-3" />
                    </a>
                  )}
                </Show>
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
