import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card, Layer, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { IdeaItemParts, RoutineIdeaText } from '../context/ideas-source';
import {
  type Idea,
  type IdeaStatus,
  type IdeaTarget,
  ideaResult,
} from '../core/idea';
import { IdeaTile } from './idea-tile';

export type IdeaCardProps = {
  idea: Idea;
  status: IdeaStatus;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  routine?: RoutineIdeaText;
  parts: IdeaItemParts;
  onAccept(): void;
  onOpen(): void;
  /** Put a prompt idea's prompt in the composer, to edit before running. */
  onOpenInChat(): void;
  onOpenSource(target: IdeaTarget): void;
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
        <Badge variant="accent" size="xs">
          <Spinner size="sm" decorative class="size-3" />
          {t('ideas.badgeRunning')}
        </Badge>
      </Match>
      <Match when={props.status === 'failed'}>
        <Badge variant="secondary" size="xs">
          <WarningIcon class="size-3 text-failure" />
          {t('ideas.badgeFailed')}
        </Badge>
      </Match>
      <Match when={props.status === 'done'}>
        <Badge variant="success" size="xs">
          <CheckIcon class="size-3" />
          {t('ideas.badgeDone')}
        </Badge>
      </Match>
      <Match when={props.idea.kind === 'routine'}>
        <Badge variant="violet" size="xs">
          {t('ideas.badgeRoutine')}
        </Badge>
      </Match>
    </Switch>
  );
}

/** When the idea arrived, its run started, or it finished, in words. */
function ideaTime(idea: Idea, status: IdeaStatus): string | undefined {
  if (status === 'running') {
    const startedAt = backgroundIdea(idea)?.run?.startedAt;
    if (!startedAt) return undefined;

    return t('ideas.started', {
      when: formatRelativeTimestamp(startedAt, { condensed: true }),
    });
  }
  if (status === 'done') {
    return formatRelativeTimestamp(idea.stateChangedAt, { condensed: true });
  }
  // A routine idea is not about a moment.
  if (idea.kind === 'routine') return undefined;

  return formatRelativeTimestamp(idea.createdAt, { condensed: true });
}

/** A block one step forward from the card: a quote, a draft, a result. */
function Inset(props: { class?: string; children: JSX.Element }) {
  return (
    <Layer offset={1}>
      <div
        class={`min-w-0 rounded-lg bg-surface px-3 py-2 text-sm leading-6 ${props.class ?? ''}`}
      >
        {props.children}
      </div>
    </Layer>
  );
}

/** What a background run will post or send, said before Run. */
function RunEffects(props: { sends: string | undefined }) {
  return (
    <p class="flex min-w-0 items-start gap-2 text-sm text-ink">
      <PaperPlaneIcon
        class="mt-0.5 size-4 shrink-0"
        classList={{
          'text-warning': !!props.sends,
          'text-ink-extra-muted': !props.sends,
        }}
      />
      <span class="min-w-0" data-idea-sends>
        {props.sends ?? t('ideas.sendsNothing')}
      </span>
    </p>
  );
}

/** A routine's sentence, with the values AI picked in violet, and when it runs. */
function RoutineSentence(props: { text: RoutineIdeaText; summary: string }) {
  const hasSentence = () =>
    props.text.sentence.some((part) => part.text.trim());

  return (
    <>
      <Show when={hasSentence()}>
        <p class="text-base leading-7 text-ink-muted">
          <For each={props.text.sentence}>
            {(part) => (
              <Show when={part.picked} fallback={part.text}>
                <span class="rounded-sm px-0.5 font-medium text-violet-ink underline decoration-2 underline-offset-4">
                  {part.text}
                </span>
              </Show>
            )}
          </For>
        </p>
      </Show>
      <p class="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-extra-muted">
        <LightningIcon class="size-3.5 shrink-0 text-violet-ink" />
        <span class="shrink-0 text-ink-muted">{props.text.when}</span>
        <Show when={hasSentence() && props.summary}>
          <span class="truncate">· {props.summary}</span>
        </Show>
      </p>
    </>
  );
}

/** The one block under the sentence, by kind: prompt, draft or routine. */
function IdeaBody(props: IdeaCardProps) {
  return (
    <Switch>
      <Match when={props.idea.kind === 'prompt' && props.idea} keyed>
        {(prompt) => (
          <>
            <Inset class="flex items-end gap-2 text-ink-muted">
              <p
                class="line-clamp-3 min-w-0 flex-1"
                role="note"
                aria-label={t('ideas.promptLabel')}
              >
                “{prompt.prompt}”
              </p>
              <button
                type="button"
                class="shrink-0 font-medium text-accent outline-none not-touch:hover:underline focus-visible:underline"
                onClick={props.onOpenInChat}
              >
                {t('ideas.editPrompt')}
              </button>
            </Inset>
            <Show when={prompt.runMode === 'background' && prompt} keyed>
              {(background) => <RunEffects sends={background.sends} />}
            </Show>
          </>
        )}
      </Match>
      <Match when={props.idea.kind === 'entity' && props.idea.draft} keyed>
        {(draft) => (
          <div class="min-w-0 rounded-lg border border-edge-muted px-3 py-2.5">
            <p class="flex items-center gap-1.5 text-[13px] text-ink-extra-muted">
              <ArrowBendUpLeftIcon class="size-3.5" />
              {t('ideas.draftReply')}
            </p>
            <div class="mt-1 text-sm leading-6 text-ink" data-idea-draft>
              <props.parts.Draft draft={draft} />
            </div>
          </div>
        )}
      </Match>
      <Match when={props.idea.kind === 'routine' && props.routine} keyed>
        {(text) => <RoutineSentence text={text} summary={props.idea.summary} />}
      </Match>
    </Switch>
  );
}

function CardActions(props: IdeaCardProps): JSX.Element {
  const acceptLabel = () => {
    const idea = props.idea;
    if (idea.kind === 'routine') return t('ideas.turnOn');
    if (idea.kind === 'entity') {
      return idea.draft ? t('ideas.openDraft') : t('ideas.openItem');
    }
    if (idea.runMode === 'composer') return t('ideas.openInChat');

    return props.status === 'failed'
      ? t('ideas.runAgain')
      : t('ideas.runInBackground');
  };
  const background = () => backgroundIdea(props.idea);

  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          {t('ideas.viewProgress')}
        </Button>
      </Match>
      <Match when={props.status === 'done'}>
        <Button variant="secondary" size="sm" onClick={props.onOpen}>
          {t('ideas.openResult')}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDismiss}>
          <CheckIcon class="size-3.5" />
          {t('ideas.clear')}
        </Button>
      </Match>
      <Match when={props.status === 'open' || props.status === 'failed'}>
        <Show when={props.idea.kind === 'routine'}>
          <Button variant="ghost" size="sm" onClick={props.onReview}>
            {t('ideas.review')}
          </Button>
        </Show>
        <Show when={background()}>
          <Button variant="ghost" size="sm" onClick={props.onOpenInChat}>
            {t('ideas.openInChat')}
          </Button>
        </Show>
        <Button
          variant="primary"
          size="sm"
          loading={props.busy}
          onClick={props.onAccept}
          data-idea-accept
        >
          <Show when={background()}>
            <PlayIcon class="size-3.5" />
          </Show>
          {acceptLabel()}
        </Button>
      </Match>
    </Switch>
  );
}

/** The items the idea is about, as chips that open them. */
function Sources(props: IdeaCardProps) {
  return (
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <For each={props.idea.about.slice(0, 2)}>
        {(target) => (
          <props.parts.Source
            target={target}
            onOpen={() => props.onOpenSource(target)}
          />
        )}
      </For>
    </div>
  );
}

/** One idea: tile, title and state, a sentence, one block for its kind, its sources and actions. */
export function IdeaCard(props: IdeaCardProps) {
  const titleId = () => `idea-title-${props.idea.id}`;
  const waiting = () => props.status === 'open' || props.status === 'failed';
  const result = () =>
    props.status === 'done' ? ideaResult(props.idea) : undefined;
  // A routine's sentence says what it does, and a finished run's result
  // carries the line; neither repeats it as a summary.
  const showsSummary = () => {
    if (!props.idea.summary || result()) return false;
    if (!waiting() || props.idea.kind !== 'routine') return true;

    return !props.routine?.sentence.some((part) => part.text.trim());
  };

  return (
    <Card
      variant="filled"
      depth={1}
      role="article"
      aria-labelledby={titleId()}
      data-idea={props.idea.id}
      data-idea-status={props.status}
      class="gap-2 p-3.5"
    >
      <header class="flex min-w-0 items-center gap-2.5">
        <IdeaTile idea={props.idea} />
        <Show when={props.isNew}>
          <span
            class="size-1.5 shrink-0 rounded-full bg-violet"
            role="img"
            aria-label={t('ideas.newIdea')}
          />
        </Show>
        <h2 id={titleId()} class="min-w-0 truncate text-base font-medium">
          {props.idea.title}
        </h2>
        <StateBadge idea={props.idea} status={props.status} />
        <Show when={ideaTime(props.idea, props.status)}>
          {(time) => (
            <span
              class="ml-auto shrink-0 pl-2 text-[13px] text-ink-extra-muted"
              data-idea-time
            >
              {time()}
            </span>
          )}
        </Show>
        <Button
          class={
            ideaTime(props.idea, props.status) ? 'shrink-0' : 'ml-auto shrink-0'
          }
          variant="ghost"
          size="icon-sm"
          aria-label={t('ideas.dismissIdea', { title: props.idea.title })}
          tooltip={t('ideas.dismiss')}
          onClick={props.onDismiss}
        >
          <CloseIcon class="size-4" />
        </Button>
      </header>
      <div class="flex min-w-0 flex-col gap-2.5 pl-9.5">
        <Show when={showsSummary()}>
          <p class="text-[15px] leading-6 text-ink-muted">
            {props.idea.summary}
          </p>
        </Show>
        <Show when={waiting()}>
          <IdeaBody {...props} />
        </Show>
        <Show when={result()} keyed>
          {(target) => (
            <Inset class="py-2.5">
              <props.parts.Result target={target} line={props.idea.summary} />
            </Inset>
          )}
        </Show>
        <Show when={props.status === 'failed'}>
          <p class="text-sm text-failure">{t('ideas.runFailed')}</p>
        </Show>
        <Show when={props.failed}>
          <p role="alert" class="text-sm text-failure">
            {t('ideas.actionFailed')}
          </p>
        </Show>
        <div class="flex min-w-0 items-center gap-2">
          <Sources {...props} />
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <CardActions {...props} />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** A finished idea that made nothing to preview: one line and how to open it. */
export function DoneIdeaRow(props: { idea: Idea; onOpen(): void }) {
  const openLabel = () => {
    const idea = props.idea;
    if (idea.kind === 'routine') return t('ideas.openRoutine');
    if (idea.kind === 'entity' && idea.draft) return t('ideas.openDraft');
    if (idea.about[0]?.entityType === 'email_thread') {
      return t('ideas.openThread');
    }

    return t('ideas.openItem');
  };

  return (
    <Card
      variant="filled"
      depth={1}
      role="article"
      aria-labelledby={`idea-title-${props.idea.id}`}
      data-idea={props.idea.id}
      data-idea-status="done"
      class="flex-row items-center gap-2.5 px-3.5 py-2.5"
    >
      <IdeaTile idea={props.idea} finished />
      <h2
        id={`idea-title-${props.idea.id}`}
        class="min-w-0 truncate text-[15px] font-normal text-ink-muted"
      >
        {props.idea.title}
      </h2>
      <span class="shrink-0 text-[13px] text-ink-extra-muted" data-idea-time>
        {formatRelativeTimestamp(props.idea.stateChangedAt, {
          condensed: true,
        })}
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={props.onOpen}>
          {openLabel()}
        </Button>
      </div>
    </Card>
  );
}

/** A dismissed idea, until the person leaves: one line and Undo. */
export function DismissedIdea(props: { idea: Idea; onUndo(): void }) {
  return (
    <div
      class="flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-edge px-4 py-2.5 text-sm text-ink-muted"
      data-idea-dismissed={props.idea.id}
    >
      <EyeSlashIcon class="size-4 shrink-0" />
      <p class="min-w-0 flex-1 truncate">
        {t('ideas.dismissed', { title: props.idea.title })}
      </p>
      <Button variant="ghost" size="sm" onClick={props.onUndo}>
        {t('ideas.undo')}
      </Button>
    </div>
  );
}
