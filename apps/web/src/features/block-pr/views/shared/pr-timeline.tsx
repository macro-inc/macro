import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckCircle from '@icon/system/regular/check-circle.svg';
import File from '@icon/system/regular/file.svg';
import GitCommit from '@icon/system/regular/git-commit.svg';
import { normalizeGithubMarkdown } from '@macro-inc/lexical-core';
import { Key } from '@solid-primitives/keyed';
import { Button, ToggleSwitch } from '@ui';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { usePrPage } from '../../context/pr-page-context';
import type {
  PrPageComment,
  PrPageReadModel,
} from '../../context/pr-page-read-model';
import { parsePrSuggestion } from '../../primitives/pr-page-state';
import {
  type PrPageTimelineItem,
  prPageTimelineFeed,
} from '../../primitives/pr-page-timeline';
import { PrExpandableBody } from './pr-expandable-body';
import { PrGithubAvatar, PrOpenedDate } from './pr-header';

export function PrCommentBody(props: {
  comment: PrPageComment;
  pending?: boolean;
}) {
  const { actions } = usePrPage();
  const flow = useFlow();
  const suggestion = () => parsePrSuggestion(props.comment.body);
  const commit = () =>
    fireAndForget(
      flow.task('pr.commit-suggestion', async () => {
        await actions.commitSuggestion.run?.(props.comment.id);
      }),
      'pr-suggestion'
    );
  return (
    <PrExpandableBody>
      <StaticMarkdownContext>
        <div class="ph-no-capture flex min-w-0 flex-col gap-3 overflow-x-auto text-sm wrap-break-word">
          <Switch>
            <Match when={suggestion()}>
              {(value) => (
                <>
                  <Show when={value().before}>
                    <StaticMarkdown
                      markdown={normalizeGithubMarkdown(value().before)}
                      target="internal"
                    />
                  </Show>
                  <div class="flex flex-col gap-2 overflow-hidden rounded-lg border border-edge-muted bg-hover p-3">
                    <span class="text-xs text-ink-muted">
                      {t('prPage.suggestion')}
                    </span>
                    <pre class="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-success">
                      {value().suggestion}
                    </pre>
                    <Show
                      when={
                        !props.pending && actions.commitSuggestion.available()
                      }
                    >
                      <div>
                        <Button size="sm" variant="secondary" onClick={commit}>
                          {t('prPage.commitSuggestion')}
                        </Button>
                      </div>
                    </Show>
                  </div>
                  <Show when={value().after}>
                    <StaticMarkdown
                      markdown={normalizeGithubMarkdown(value().after)}
                      target="internal"
                    />
                  </Show>
                </>
              )}
            </Match>
            <Match when={true}>
              <StaticMarkdown
                markdown={normalizeGithubMarkdown(props.comment.body)}
                target="internal"
              />
            </Match>
          </Switch>
        </div>
      </StaticMarkdownContext>
    </PrExpandableBody>
  );
}

export function PrTimelineComment(props: {
  comment: PrPageComment;
  replies?: PrPageComment[];
  onFile?: (path: string) => void;
  pending?: boolean;
  isReply?: boolean;
}) {
  const { actions } = usePrPage();
  const flow = useFlow();
  const [reply, setReply] = createStore({
    open: false,
    body: '',
    pending: false,
  });
  const sendReply = async () => {
    if (reply.pending || !reply.body.trim() || !actions.reply.run) return;
    setReply('pending', true);
    try {
      await flow.task('pr.reply', async () => {
        await actions.reply.run?.(props.comment.id, reply.body.trim());
      });
      setReply({ open: false, body: '' });
    } finally {
      setReply('pending', false);
    }
  };
  return (
    <article class="flex min-w-0 items-start gap-3 py-3">
      <Show when={props.comment.authorLogin}>
        {(login) => <PrGithubAvatar login={login()} />}
      </Show>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span class="font-medium text-ink">{props.comment.authorLogin}</span>
          <Switch>
            <Match when={props.pending}>
              <span class="text-accent">{t('prPage.pendingReview')}</span>
            </Match>
            <Match
              when={
                props.comment.source === 'review' &&
                props.comment.reviewState === 'approved'
              }
            >
              <CheckCircle class="size-3.5 text-success" />
              <span>{t('prPage.approved')}</span>
            </Match>
            <Match
              when={
                props.comment.source === 'review' &&
                props.comment.reviewState === 'changes_requested'
              }
            >
              <span class="text-failure">{t('prPage.changesRequested')}</span>
            </Match>
            <Match
              when={
                props.comment.source === 'review' &&
                props.comment.reviewState === 'commented'
              }
            >
              <span>{t('prPage.commented')}</span>
            </Match>
            <Match
              when={
                props.comment.source === 'review' &&
                props.comment.reviewState === 'dismissed'
              }
            >
              <span>{t('prPage.dismissed')}</span>
            </Match>
          </Switch>
          <PrOpenedDate value={props.comment.createdAt} />
          <Show when={props.comment.path}>
            {(path) => (
              <button
                type="button"
                class="inline-flex min-w-0 items-center gap-1 rounded bg-hover px-2 py-0.5 font-mono not-touch:hover:bg-active"
                onClick={() => props.onFile?.(path())}
              >
                <File class="size-3 shrink-0" />
                <span class="truncate">
                  {path()}
                  {props.comment.line ? `:${props.comment.line}` : ''}
                </span>
              </button>
            )}
          </Show>
        </div>
        <PrCommentBody comment={props.comment} pending={props.pending} />
        <Key each={props.replies ?? []} by="id">
          {(comment) => (
            <PrTimelineComment
              comment={comment()}
              onFile={props.onFile}
              isReply
            />
          )}
        </Key>
        <div class="flex items-center gap-1 empty:hidden">
          <Show
            when={
              !props.isReply &&
              !props.pending &&
              props.comment.source === 'review_comment' &&
              actions.reply.available()
            }
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReply('open', !reply.open)}
            >
              {t('prPage.reply')}
            </Button>
          </Show>
          <Show
            when={
              !props.isReply &&
              !props.pending &&
              props.comment.source === 'review_comment' &&
              actions.resolveThread.available()
            }
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                fireAndForget(
                  Promise.resolve(
                    actions.resolveThread.run?.(props.comment.id)
                  ),
                  'pr-resolve-thread'
                )
              }
            >
              {t('prPage.resolve')}
            </Button>
          </Show>
        </div>
        <Show when={reply.open}>
          <form
            class="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(sendReply(), 'pr-reply');
            }}
          >
            <textarea
              aria-label={t('prPage.reply')}
              class="min-h-20 w-full rounded-md bg-input p-3 text-sm"
              value={reply.body}
              readOnly={reply.pending}
              onInput={(event) => setReply('body', event.currentTarget.value)}
            />
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                type="submit"
                disabled={!reply.body.trim() || reply.pending}
              >
                {t('prPage.reply')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReply('open', false)}
              >
                {t('prPage.cancel')}
              </Button>
            </div>
          </form>
        </Show>
      </div>
    </article>
  );
}

export function PrDescription(props: { page: PrPageReadModel }) {
  return (
    <Show when={props.page.pullRequest.description}>
      <section class="flex min-w-0 flex-col gap-3 border-b border-edge-muted py-6">
        <Show when={props.page.pullRequest.authorLogin}>
          {(login) => (
            <div class="flex items-center gap-2 text-xs text-ink-muted">
              <PrGithubAvatar login={login()} />
              <span class="font-medium text-ink">{login()}</span>
              <PrOpenedDate value={props.page.githubCreatedAt} opened />
            </div>
          )}
        </Show>
        <PrExpandableBody class="touch:[--pr-body-limit:300px]">
          <StaticMarkdownContext>
            <div class="ph-no-capture min-w-0 overflow-x-auto text-sm wrap-break-word">
              <StaticMarkdown
                markdown={normalizeGithubMarkdown(
                  props.page.pullRequest.description ?? ''
                )}
                target="internal"
              />
            </div>
          </StaticMarkdownContext>
        </PrExpandableBody>
      </section>
    </Show>
  );
}

export function PrTimeline(props: {
  page: PrPageReadModel;
  onFile: (path: string) => void;
}) {
  const [hideBots, setHideBots] = createSignal(false);
  const comments = createMemo(() => props.page.comments);
  const pushes = createMemo(() => props.page.pushes);
  const entries = createMemo(() =>
    prPageTimelineFeed(comments(), pushes(), hideBots())
  );
  return (
    <section class="flex min-w-0 flex-col gap-2 py-5">
      <div class="flex items-center justify-between gap-3 py-1">
        <h2 class="text-sm text-ink-muted">{t('prPage.discussion')}</h2>
        <ToggleSwitch
          size="sm"
          label={t('prPage.hideBots')}
          checked={hideBots()}
          onChange={setHideBots}
        />
      </div>
      <Key each={entries()} by="key">
        {(entry) => <PrTimelineItemView item={entry()} onFile={props.onFile} />}
      </Key>
    </section>
  );
}

function PrTimelineItemView(props: {
  item: PrPageTimelineItem;
  onFile: (path: string) => void;
}) {
  return (
    <Switch>
      <Match when={props.item.kind === 'comment' ? props.item : undefined}>
        {(entry) => (
          <PrTimelineComment
            comment={entry().comment}
            replies={entry().replies}
            onFile={props.onFile}
          />
        )}
      </Match>
      <Match when={props.item.kind === 'push' ? props.item : undefined}>
        {(entry) => (
          <PrTimelineEvent
            label={entry().label}
            createdAt={entry().createdAt}
          />
        )}
      </Match>
    </Switch>
  );
}

export function PrTimelineEvent(props: { label: string; createdAt: string }) {
  return (
    <div class="flex items-center gap-3 py-2 text-xs text-ink-muted">
      <GitCommit class="size-4" />
      <span>{props.label}</span>
      <PrOpenedDate value={props.createdAt} />
    </div>
  );
}
