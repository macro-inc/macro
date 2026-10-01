/**
 * The card a Cursor `<system_notification>` renders as: an event that
 * happened to the session — a CI run finishing, a thread reply, a timer —
 * rather than something a person typed. Cursor writes these into the prompt
 * stream when a run subscribes to something outside the conversation; see
 * `CursorSystemNotificationNode` for the wire shape.
 *
 * The attributes Cursor sends are not a fixed schema, so the card knows the
 * handful worth a face (repository, branch, commit, checks, a status word)
 * and lists whatever else it carried as plain `name: value` chips, hiding
 * only the subscription bookkeeping nobody reads.
 */

import { openExternalUrl } from '@core/util/url';
import type { CursorSystemNotificationDecoratorProps } from '@macro-inc/lexical-core';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import BellIcon from '@phosphor/bell.svg';
import CheckCircleIcon from '@phosphor/check-circle.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitCommitIcon from '@phosphor/git-commit.svg';
import GithubLogoIcon from '@phosphor/github-logo.svg';
import SlackLogoIcon from '@phosphor/slack-logo.svg';
import TimerIcon from '@phosphor/timer.svg';
import XCircleIcon from '@phosphor/x-circle.svg';
import { cn } from '@ui/utils/classname';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

/** How the source names itself in the card's header. */
export function sourceLabel(source: string): string {
  return match(source.toLowerCase())
    .with('github', () => 'GitHub')
    .with('slack', () => 'Slack')
    .with('linear', () => 'Linear')
    .with('timer', () => 'Timer')
    .otherwise(() =>
      source ? source.charAt(0).toUpperCase() + source.slice(1) : 'System'
    );
}

function sourceIcon(source: string): Component<{ class?: string }> {
  return match(source.toLowerCase())
    .with('github', () => GithubLogoIcon)
    .with('slack', () => SlackLogoIcon)
    .with('timer', () => TimerIcon)
    .otherwise(() => BellIcon);
}

/**
 * What kind of event this was, from Cursor's `subscriptionType`
 * (`github:ci:branch`, `slack:thread`, `linear:issue`, `timer`). Unknown
 * types read as their words.
 */
export function kindLabel(subscriptionType: string | undefined): string {
  if (!subscriptionType) return 'Notification';
  return match(subscriptionType)
    .with('github:ci', 'github:ci:branch', 'github:ci:pr', () => 'CI checks')
    .with('github:pr', () => 'Pull request')
    .with('slack:thread', () => 'Thread reply')
    .with('slack:channel', () => 'Channel message')
    .with('linear:issue', () => 'Issue update')
    .with('linear:comment', () => 'Issue comment')
    .with('timer', () => 'Timer')
    .otherwise((type) => {
      const words = type.split(/[:_-]+/).filter(Boolean);
      const label = words.slice(1).join(' ') || words.join(' ');
      return label.charAt(0).toUpperCase() + label.slice(1);
    });
}

type Tone = 'success' | 'failure' | 'neutral';

/** The tone a status word carries: green for a pass, red for anything that went wrong. */
export function conclusionTone(conclusion: string | undefined): Tone {
  return match(conclusion?.toLowerCase())
    .with('success', 'passed', 'completed', 'merged', () => 'success' as const)
    .with(
      'failure',
      'failed',
      'error',
      'cancelled',
      'canceled',
      'timed_out',
      'action_required',
      () => 'failure' as const
    )
    .otherwise(() => 'neutral' as const);
}

function conclusionLabel(conclusion: string): string {
  const words = conclusion.replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** A repository as Cursor spells it (`github.com/org/repo`, sometimes with a scheme) as a URL. */
function repositoryUrl(repo: string): string | undefined {
  const value = repo.trim();
  return safeHttpUrl(
    /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
  );
}

/** `github.com/org/repo` reads as `org/repo`; anything else is left alone. */
function repositoryName(repo: string): string {
  return repo.replace(/^(?:[a-z]+:\/\/)?(?:www\.)?github\.com\//i, '');
}

/** Attributes the card renders with their own face, or deliberately not at all. */
const FEATURED = new Set([
  'repo',
  'repository',
  'branch',
  'commit',
  'sha',
  'checks',
  'conclusion',
  'status',
  'url',
  'link',
  'subscriptionId',
  'subscriptionType',
]);

type Detail = {
  label: string;
  icon?: Component<{ class?: string }>;
  href?: string;
  title?: string;
};

/** The footer chips, in reading order. */
export function details(attributes: Record<string, string>): Detail[] {
  const repo = attributes.repo ?? attributes.repository;
  const sha = attributes.commit ?? attributes.sha;
  const repoHref = repo ? repositoryUrl(repo) : undefined;
  const chips: Detail[] = [];
  if (repo) {
    chips.push({
      label: repositoryName(repo),
      icon: GithubLogoIcon,
      href: repoHref,
    });
  }
  if (attributes.branch) {
    chips.push({ label: attributes.branch, icon: GitBranchIcon });
  }
  if (sha) {
    chips.push({
      label: sha.slice(0, 7),
      icon: GitCommitIcon,
      title: sha,
      href: repoHref
        ? `${repoHref.replace(/\/$/, '')}/commit/${encodeURIComponent(sha)}`
        : undefined,
    });
  }
  if (attributes.checks) {
    const count = Number(attributes.checks);
    chips.push({
      label: Number.isFinite(count)
        ? `${count} ${count === 1 ? 'check' : 'checks'}`
        : attributes.checks,
    });
  }
  const link = attributes.url ?? attributes.link;
  if (link) {
    const href = safeHttpUrl(link);
    if (href) chips.push({ label: 'Open', icon: ArrowUpRightIcon, href });
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (FEATURED.has(name) || !value) continue;
    chips.push({ label: `${name}: ${value}` });
  }
  return chips;
}

function DetailChip(props: { detail: Detail }) {
  const href = () => props.detail.href;
  return (
    <Dynamic
      component={href() ? 'a' : 'span'}
      href={href()}
      title={props.detail.title ?? href()}
      class={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-edge-muted px-1.5 py-0.5 text-xs text-ink-muted',
        href() &&
          'pointer-events-auto no-underline outline-none transition-colors hover:border-edge hover:text-ink focus-visible:text-ink'
      )}
      // The card sits in an editor: a click is an action, not a caret target.
      onMouseDown={(event: MouseEvent) => {
        if (href()) event.preventDefault();
      }}
      onClick={(event: MouseEvent) => {
        const target = href();
        if (!target) return;
        event.preventDefault();
        openExternalUrl(target);
      }}
    >
      <Show when={props.detail.icon}>
        {(icon) => <Dynamic component={icon()} class="size-3 shrink-0" />}
      </Show>
      <span class="truncate">{props.detail.label}</span>
    </Dynamic>
  );
}

export function CursorSystemNotification(
  props: CursorSystemNotificationDecoratorProps
) {
  const conclusion = () =>
    props.attributes.conclusion ?? props.attributes.status;
  const tone = () => conclusionTone(conclusion());
  const chips = () => details(props.attributes);

  return (
    <section
      data-system-notification={props.source}
      aria-label={`${sourceLabel(props.source)} notification`}
      class="my-1.5 min-w-0 max-w-full overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-3 pt-3">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-ink-muted">
          <Dynamic component={sourceIcon(props.source)} class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-5 text-ink-muted">
            <span class="font-medium text-ink">
              {sourceLabel(props.source)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{kindLabel(props.attributes.subscriptionType)}</span>
            <Show when={conclusion()}>
              {(word) => (
                <span
                  data-tone={tone()}
                  class={cn(
                    'ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    match(tone())
                      .with('success', () => 'bg-success-bg text-success-ink')
                      .with('failure', () => 'bg-failure-bg text-failure-ink')
                      .with('neutral', () => 'bg-accent-bg text-ink-muted')
                      .exhaustive()
                  )}
                >
                  {match(tone())
                    .with('success', () => <CheckCircleIcon class="size-3.5" />)
                    .with('failure', () => <XCircleIcon class="size-3.5" />)
                    .with('neutral', () => null)
                    .exhaustive()}
                  {conclusionLabel(word())}
                </span>
              )}
            </Show>
          </div>
          <Show when={props.text}>
            <p class="mt-0.5 whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]">
              {props.text}
            </p>
          </Show>
        </div>
      </div>
      <Show when={chips().length > 0}>
        <div class="flex flex-wrap gap-1.5 px-3 pb-3 pt-2">
          <For each={chips()}>{(detail) => <DetailChip detail={detail} />}</For>
        </div>
      </Show>
    </section>
  );
}
