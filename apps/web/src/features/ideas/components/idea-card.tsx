import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { RoutineIdeaText } from '../context/ideas-source';
import type { Idea, IdeaStatus } from '../core/idea';
import { IdeaGlyph } from './idea-tile';

export type IdeaCardProps = {
  idea: Idea;
  status: IdeaStatus;
  busy: boolean;
  failed: boolean;
  routine?: RoutineIdeaText;
  onAccept(): void;
  onOpen(): void;
  onReview(): void;
  onDismiss(): void;
};

type BackgroundIdea = Extract<Idea, { runMode: 'background' }>;

function backgroundIdea(idea: Idea): BackgroundIdea | undefined {
  return idea.kind === 'prompt' && idea.runMode === 'background'
    ? idea
    : undefined;
}

function StateBadge(props: { idea: Idea; status: IdeaStatus }) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Badge variant="secondary" size="xs">
          {t('ideas.badgeRunning')}
        </Badge>
      </Match>
      <Match when={props.status === 'failed'}>
        <Badge variant="secondary" size="xs">
          {t('ideas.badgeFailed')}
        </Badge>
      </Match>
      <Match when={props.status === 'done'}>
        <Badge variant="secondary" size="xs">
          {t('ideas.badgeDone')}
        </Badge>
      </Match>
      <Match when={props.idea.kind === 'routine'}>
        <Badge variant="secondary" size="xs">
          {t('ideas.badgeRoutine')}
        </Badge>
      </Match>
    </Switch>
  );
}

/**
 * What clicking the card does. A background idea that has not run has no
 * card-wide action: starting a run is its own button, pressed on purpose.
 */
function cardAction(
  props: IdeaCardProps
): { label: string; run(): void } | undefined {
  const { idea, status } = props;
  const background = backgroundIdea(idea);

  if (status === 'running') {
    return { label: t('ideas.viewProgress'), run: props.onOpen };
  }
  if (status === 'done') {
    if (background) return { label: t('ideas.openResult'), run: props.onOpen };
    const label =
      idea.kind === 'entity' && idea.draft
        ? t('ideas.openDraft')
        : t('ideas.openItem');
    return { label, run: props.onOpen };
  }
  if (background) return undefined;
  if (idea.kind === 'routine') {
    return { label: t('ideas.review'), run: props.onReview };
  }
  if (idea.kind === 'entity') {
    const label = idea.draft ? t('ideas.openDraft') : t('ideas.openItem');
    return { label, run: props.onAccept };
  }

  return { label: t('ideas.run'), run: props.onAccept };
}

/**
 * The card's title. With a card-wide action it is a button whose hit area
 * covers the card, like a routine suggestion's; controls on the card are
 * positioned, so they sit above it.
 */
function CardTitle(props: IdeaCardProps & { id: string }) {
  const action = () => cardAction(props);

  return (
    <Show
      when={action()}
      fallback={
        <span id={props.id} class="min-w-0 truncate text-sm font-medium">
          {props.idea.title}
        </span>
      }
      keyed
    >
      {(target) => (
        <button
          type="button"
          aria-label={target.label}
          class="min-w-0 truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] not-touch:hover:after:bg-hover focus-visible:static focus-visible:after:ring-2 focus-visible:after:ring-edge-focus"
          classList={{ 'text-ink-muted': props.status === 'done' }}
          data-idea-accept
          onClick={() => target.run()}
        >
          <span id={props.id}>{props.idea.title}</span>
        </button>
      )}
    </Show>
  );
}

/** What it is about: a routine's sentence with AI's values in violet, else the summary. */
function IdeaText(props: { idea: Idea; routine?: RoutineIdeaText }) {
  return (
    <p class="line-clamp-2 min-h-11 text-[13px] leading-[22px] text-ink-muted">
      <Show
        when={
          props.idea.kind === 'routine' &&
          // A routine without values to show reads better as its summary.
          props.routine?.sentence.some((part) => part.text.trim()) &&
          props.routine
        }
        fallback={props.idea.summary}
        keyed
      >
        {(text) => (
          <For each={text.sentence}>
            {(part) => (
              <Show when={part.picked} fallback={part.text}>
                <span class="font-medium text-violet-ink">{part.text}</span>
              </Show>
            )}
          </For>
        )}
      </Show>
    </p>
  );
}

/** The one quiet line under the card: what taking the idea up involves. */
function metaLine(props: IdeaCardProps): string {
  const { idea, status } = props;
  const background = backgroundIdea(idea);

  if (status === 'running') {
    const startedAt = background?.run?.startedAt;
    return startedAt
      ? t('ideas.runningSince', { when: formatRelativeTimestamp(startedAt) })
      : t('ideas.runningNow');
  }
  if (status === 'failed') return t('ideas.runFailed');
  if (status === 'done') return '';
  // Run on a background idea is the approval, so it says what it sends first.
  if (background) return background.sends ?? t('ideas.sendsNothing');
  if (idea.kind === 'routine') return props.routine?.when ?? '';
  if (idea.kind === 'entity') return idea.draft ? t('ideas.draftReady') : '';

  return t('ideas.opensComposer');
}

/**
 * The card's one visible action. Starting a background run and turning a
 * routine on are real buttons; everything else is a quiet label for what
 * clicking the card does.
 */
function FooterAction(props: IdeaCardProps) {
  const waiting = () => props.status === 'open' || props.status === 'failed';

  return (
    <Switch>
      <Match when={waiting() && backgroundIdea(props.idea)}>
        <Button
          variant="secondary"
          size="xs"
          class="relative"
          loading={props.busy}
          onClick={props.onAccept}
          data-idea-accept
        >
          {props.status === 'failed'
            ? t('ideas.runAgain')
            : t('ideas.runInBackground')}
        </Button>
      </Match>
      <Match when={waiting() && props.idea.kind === 'routine'}>
        <Button
          variant="secondary"
          size="xs"
          class="relative"
          loading={props.busy}
          onClick={props.onAccept}
          data-idea-accept
        >
          {t('ideas.turnOn')}
        </Button>
      </Match>
      <Match when={cardAction(props)} keyed>
        {(action) => (
          <span
            aria-hidden="true"
            class="flex shrink-0 items-center gap-1 text-xs font-medium text-ink-muted not-touch:group-hover/card:text-ink"
          >
            {action.label}
            <ArrowRightIcon class="size-3" />
          </span>
        )}
      </Match>
    </Switch>
  );
}

/** One idea, built like a routine suggestion card so the two read as a family. */
export function IdeaCard(props: IdeaCardProps) {
  const titleId = () => `idea-title-${props.idea.id}`;
  const sends = () =>
    props.status === 'open' && !!backgroundIdea(props.idea)?.sends;

  return (
    <Card
      variant="filled"
      depth={3}
      role="article"
      aria-labelledby={titleId()}
      data-idea={props.idea.id}
      data-idea-status={props.status}
      class="group/card relative flex h-full min-w-0 flex-col gap-1.5 p-4"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex shrink-0" aria-hidden="true">
          <IdeaGlyph idea={props.idea} status={props.status} />
        </span>
        <span class="flex-1" />
        <StateBadge idea={props.idea} status={props.status} />
        <Button
          variant="ghost"
          size="icon-xs"
          class="relative z-[1] -my-1 -mr-1 not-touch:opacity-0 not-touch:group-hover/card:opacity-100 not-touch:focus-visible:opacity-100"
          aria-label={t('ideas.dismissIdea', { title: props.idea.title })}
          tooltip={t('ideas.dismiss')}
          onClick={props.onDismiss}
        >
          <CloseIcon class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <h2 class="mt-0.5 flex min-w-0">
        <CardTitle {...props} id={titleId()} />
      </h2>
      <IdeaText idea={props.idea} routine={props.routine} />
      <Show when={props.failed}>
        <p role="alert" class="text-xs text-failure">
          {t('ideas.actionFailed')}
        </p>
      </Show>
      <div class="mt-auto flex min-w-0 items-center gap-2 border-t border-edge-divider pt-3">
        <span
          class="min-w-0 flex-1 text-xs text-ink-extra-muted"
          classList={{ 'text-warning': sends(), truncate: !sends() }}
          data-idea-meta
        >
          {metaLine(props)}
        </span>
        <FooterAction {...props} />
      </div>
    </Card>
  );
}

/** A dismissed idea, until the person leaves: one line and Undo. */
export function DismissedIdea(props: { idea: Idea; onUndo(): void }) {
  return (
    <Card
      variant="outlined"
      class="h-full flex-row items-center gap-3 p-4 text-sm text-ink-muted"
      data-idea-dismissed={props.idea.id}
    >
      <EyeSlashIcon class="size-4 shrink-0" />
      <p class="min-w-0 flex-1">
        {t('ideas.dismissed', { title: props.idea.title })}
      </p>
      <Button variant="ghost" size="sm" onClick={props.onUndo}>
        {t('ideas.undo')}
      </Button>
    </Card>
  );
}
