import { SidePanel } from '@components/app/side-panel/SidePanel';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CheckCircle from '@icon/system/regular/check-circle.svg';
import Circle from '@icon/system/regular/circle.svg';
import CircleNotch from '@icon/system/regular/circle-notch.svg';
import MinusCircle from '@icon/system/regular/minus-circle.svg';
import XCircle from '@icon/system/regular/x-circle.svg';
import type {
  GithubPullRequest,
  GithubPullRequestCheckRun,
} from '@service-storage/generated/schemas';
import { For, Match, Show, Switch } from 'solid-js';
import { PrStatusChip as GithubPullRequestStatusChip } from '../component/PrStatus';

export {
  PrStatusChip as GithubPullRequestStatusChip,
  PrStatusIcon as GithubPullRequestStatusIcon,
} from '../component/PrStatus';

type GithubPullRequestWithPanelDetails = GithubPullRequest & {
  authorLogin?: string | null;
};

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

export function GithubPullRequestDetailsContent(props: {
  enrichment?: GithubPullRequestWithPanelDetails;
}) {
  return (
    <Show when={props.enrichment} fallback={<SidePanel.Loading />}>
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
                <span class="skeleton-shimmer size-3.5 rounded-full bg-skeleton" />
                <span class="skeleton-shimmer h-3 w-16 rounded-full bg-skeleton" />
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
          class="min-w-0 truncate text-link hover:text-link-hover visited:text-link-visited underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 hover:decoration-current"
        >
          {props.enrichment.displayName}
        </a>
      </SidePanel.Row>
    </>
  );
}

export function GithubPullRequestChecksContent(props: {
  enrichment?: GithubPullRequestWithPanelDetails;
}) {
  const checks = () => props.enrichment?.checks ?? [];
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
                      class="text-link hover:text-link-hover visited:text-link-visited transition-colors"
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
