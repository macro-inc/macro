import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import SquareSplit from '@phosphor/square-split-horizontal.svg';
import { Button, cn, Dialog } from '@ui';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { DemoMarkdown } from '../DemoMarkdown';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ReviewChanges } from './ReviewChanges';
import type {
  DemoGithubComment,
  DemoPullRequest,
  PrStatus,
} from './review-fixtures';
import '../demo-markdown.css';
import './review-stories.css';

const STATUS_CLASS: Record<PrStatus, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

/** block-pr/PrStatus: merged uses the merge glyph, the rest a PR glyph. */
export function PrIcon(props: { status: PrStatus; class?: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn('size-3.5', STATUS_CLASS[props.status], props.class)}
        />
      }
    >
      <GitMerge class={cn('size-3.5 text-note', props.class)} />
    </Show>
  );
}

export const prRef = (pr: DemoPullRequest) => `${pr.repo}#${pr.number}`;

const isBot = (login: string) => login.endsWith('[bot]');
const displayLogin = (login: string) => login.replace(/\[bot\]$/, '');

export function DemoAvatar(props: {
  person: HomepagePersonId;
  class?: string;
}) {
  return (
    <Show
      when={props.person === 'claude' || props.person === 'cursor'}
      fallback={
        <img
          src={homepagePeople[props.person].photo}
          alt=""
          class={cn('rounded-full object-cover', props.class)}
        />
      }
    >
      <span
        class={cn('sample-agent-avatar', props.class)}
        data-agent={props.person}
      >
        <Show when={props.person === 'claude'} fallback={<CursorIcon />}>
          <ClaudeIcon />
        </Show>
      </span>
    </Show>
  );
}

function Pill(props: { class?: string; children: JSX.Element }) {
  return (
    <span class={cn('review-pr-pill', props.class)}>{props.children}</span>
  );
}

/** GithubMessageView: avatar, login, file/line badge, time, then replies on a rail. */
function GithubComment(props: { comment: DemoGithubComment; reply?: boolean }) {
  return (
    <article
      class="review-gh-comment"
      data-reply={props.reply ? 'true' : undefined}
    >
      <DemoAvatar person={props.comment.person} class="size-8" />
      <div class="min-w-0">
        <div class="review-gh-header">
          <span class="truncate text-sm font-medium">
            {displayLogin(props.comment.login)}
          </span>
          <Show when={!props.reply && props.comment.badge}>
            <span
              class="review-gh-badge"
              data-anchor={props.comment.anchor ? 'true' : undefined}
              title={props.comment.anchor ? props.comment.badge : undefined}
            >
              {props.comment.badge}
            </span>
          </Show>
          <span class="ml-auto shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {props.comment.time}
          </span>
        </div>
        <p class="review-gh-body">{props.comment.body}</p>
      </div>
    </article>
  );
}

/**
 * block-pr's PrDetail: title, status/author/repo/size pills, the GitHub
 * description, read-only discussion, and a local Changes pane.
 */
export function PullRequestView(props: {
  pr: DemoPullRequest;
  status?: PrStatus;
  changes?: boolean;
  onChanges?: (open: boolean) => void;
  onMerge?: () => void;
  mergeRequested?: boolean;
  onMergeRequest?: (open: boolean) => void;
  /** Where the PR was opened from, e.g. Home's return breadcrumb. */
  crumb?: { label: string; onClick: () => void };
}) {
  const status = () => props.status ?? props.pr.status;
  const [localChanges, setLocalChanges] = createSignal(false);
  const [spotlit, setSpotlit] = createSignal(false);
  const [localConfirm, setLocalConfirm] = createSignal(false);
  const changes = () => props.changes ?? localChanges();
  const toggleChanges = (open: boolean) => {
    setLocalChanges(open);
    props.onChanges?.(open);
  };
  const confirm = () => props.mergeRequested ?? localConfirm();
  const setConfirm = (open: boolean) => {
    setLocalConfirm(open);
    props.onMergeRequest?.(open);
  };
  let mount!: HTMLDivElement;
  const [expanded, setExpanded] = createSignal(true);
  const [hideBots, setHideBots] = createSignal(false);
  const bots = () => props.pr.comments.filter((c) => isBot(c.login)).length;
  const comments = () =>
    props.pr.comments.filter((c) => !hideBots() || !isBot(c.login));
  return (
    <div
      ref={mount}
      class="review-pr-layout"
      data-changes={changes()}
      data-spotlit={spotlit()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && changes() && !confirm()) {
          event.stopPropagation();
          toggleChanges(false);
        }
      }}
    >
      <div class="review-pr-document">
        <ViewShell.TopBar>
          <Show when={props.crumb}>
            {(crumb) => (
              <>
                <button
                  type="button"
                  class="text-sm text-ink-muted"
                  onClick={() => crumb().onClick()}
                >
                  {crumb().label}
                </button>
                <span class="text-ink-muted px-1">›</span>
              </>
            )}
          </Show>
          <PrIcon status={status()} class="shrink-0" />
          <span class="min-w-0 truncate text-sm font-semibold">
            {props.pr.title}
          </span>
          <div class="ml-auto flex shrink-0 items-center gap-2 pr-1">
            <Show when={props.onMerge && status() === 'open'}>
              <Button
                data-merge
                variant="outline"
                size="sm"
                onClick={() => setConfirm(true)}
              >
                <GitMerge class="size-3.5" />
                Merge
              </Button>
            </Show>
            <Show when={props.pr.number === 491}>
              <Button
                data-changes-toggle
                variant="plain"
                size="sm"
                label="Changes"
                aria-pressed={changes()}
                onClick={() => toggleChanges(!changes())}
              >
                <SquareSplit class="size-3.5" />
                <span class="github-changes-label">Changes</span>
              </Button>
            </Show>
          </div>
        </ViewShell.TopBar>
        <div class="dummy-scroll">
          <div class="review-pr" data-pr={props.pr.number}>
            <h1>{props.pr.title}</h1>
            <div class="review-pr-meta">
              <Pill class={STATUS_CLASS[status()]}>
                <PrIcon status={status()} class="size-3 shrink-0" />
                {status().charAt(0).toUpperCase() + status().slice(1)}
              </Pill>
              <Pill class="text-ink-muted">
                <DemoAvatar person={props.pr.author} class="size-3.5" />
                {props.pr.login}
              </Pill>
              <Pill class="text-ink-muted">
                {props.pr.repo.split('/').at(-1)} #{props.pr.number}
              </Pill>
              <Pill>
                <span class="text-success">+{props.pr.additions}</span>
                <span class="text-failure">−{props.pr.deletions}</span>
              </Pill>
            </div>
            <div class="review-pr-description">
              <DemoMarkdown markdown={props.pr.description} />
            </div>
            <section class="review-pr-timeline" aria-label="Discussion">
              <div class="review-pr-timeline-head">
                <span class="review-pr-rule review-pr-rule-short" />
                <button
                  type="button"
                  aria-expanded={expanded()}
                  onClick={() => setExpanded(!expanded())}
                >
                  <Show
                    when={expanded()}
                    fallback={<CaretRight class="size-3" />}
                  >
                    <CaretDown class="size-3" />
                  </Show>
                  Discussion
                </button>
                <span class="review-pr-rule" />
                <Show when={bots() > 0}>
                  <ToggleSwitch
                    class="shrink-0"
                    checked={hideBots()}
                    onChange={setHideBots}
                    label={`Hide bots (${bots()})`}
                    labelClass="text-xs text-ink-muted"
                  />
                </Show>
              </div>
              <Show when={expanded()}>
                <div class="review-pr-comments">
                  <For each={comments()}>
                    {(comment) => (
                      <div
                        class="review-gh-thread"
                        data-thread-open={
                          comment.replies?.length ? 'true' : undefined
                        }
                      >
                        <GithubComment comment={comment} />
                        <Show when={comment.replies?.length}>
                          <div class="review-gh-replies">
                            <For each={comment.replies}>
                              {(reply) => (
                                <GithubComment comment={reply} reply />
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </div>
        </div>
      </div>
      <Show when={changes()}>
        <ReviewChanges
          expanded={spotlit()}
          onExpand={() => setSpotlit(!spotlit())}
          onClose={() => {
            toggleChanges(false);
            setSpotlit(false);
          }}
        />
      </Show>
      <Dialog
        mount={mount}
        open={confirm()}
        onOpenChange={setConfirm}
        position="center"
        class="github-merge-dialog"
      >
        <Dialog.Title>Merge pull request?</Dialog.Title>
        <Dialog.Description>
          Merge {props.pr.title} into main.
        </Dialog.Description>
        <div class="flex justify-end gap-2 mt-6">
          <Button variant="plain" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            data-confirm-merge
            variant="outline"
            onClick={() => {
              setConfirm(false);
              props.onMerge?.();
            }}
          >
            Merge pull request
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
