import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card, Item, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { IdeaItemParts, RoutineIdeaText } from '../context/ideas-source';
import type { Idea, IdeaStatus, IdeaTarget } from '../core/idea';
import { IdeaTile } from './idea-tile';

export type IdeaCardProps = {
  idea: Idea;
  status: IdeaStatus;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  /** It was rewritten since the card showed it; the action took nothing up. */
  changed: boolean;
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

/** The thread someone may be waiting on: an open reply idea's email thread. */
function replyThread(idea: Idea, status: IdeaStatus): IdeaTarget | undefined {
  if (status !== 'open' || idea.kind !== 'entity' || idea.action !== 'reply') {
    return undefined;
  }

  return idea.about.find((target) => target.entityType === 'email_thread');
}

/** The app's card for one idea: the same surface the routine cards use. */
function IdeaSurface(props: {
  idea: Idea;
  status: IdeaStatus;
  children: JSX.Element;
}) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="article"
      aria-labelledby={`idea-title-${props.idea.id}`}
      data-idea={props.idea.id}
      data-idea-status={props.status}
    >
      {props.children}
    </Card>
  );
}

/** Lines up a card's body and footer under its title, past the tile. */
const UNDER_TITLE = 'pl-12.5';

/** A routine's sentence, with the values AI picked in violet. */
function RoutineSentence(props: { text: RoutineIdeaText }) {
  return (
    <For each={props.text.sentence}>
      {(part) => (
        <Show when={part.picked} fallback={part.text}>
          <span class="font-medium text-violet-ink">{part.text}</span>
        </Show>
      )}
    </For>
  );
}

/**
 * The one sentence under the title: why the idea matters, or for a routine
 * what it will do, or that its run failed.
 */
function IdeaSentence(props: IdeaCardProps) {
  const sentence = () =>
    props.idea.kind === 'routine' &&
    props.routine?.sentence.some((part) => part.text.trim())
      ? props.routine
      : undefined;

  return (
    <Switch>
      <Match when={props.status === 'failed'}>
        <Card.Description>{t('ideas.runFailed')}</Card.Description>
      </Match>
      <Match when={sentence()} keyed>
        {(text) => (
          <Card.Description class="line-clamp-2">
            <RoutineSentence text={text} />
          </Card.Description>
        )}
      </Match>
      <Match when={props.idea.summary}>
        <Card.Description
          class={props.status === 'running' ? 'line-clamp-1' : 'line-clamp-2'}
        >
          {props.idea.summary}
        </Card.Description>
      </Match>
    </Switch>
  );
}

/**
 * What the person must read before acting, one step forward from the card:
 * the prompt a background run will follow, or the reply that was drafted.
 * Other kinds need nothing here: their action opens the thing itself.
 */
function IdeaBlock(props: IdeaCardProps) {
  const waiting = () => props.status === 'open' || props.status === 'failed';

  return (
    <Show when={waiting()}>
      <Switch>
        <Match when={backgroundIdea(props.idea)} keyed>
          {(background) => (
            <Card variant="filled" offset={1}>
              <Card.Body class="px-3 py-2 text-ink-muted">
                <p
                  class="line-clamp-2"
                  role="note"
                  aria-label={t('ideas.promptLabel')}
                >
                  “{background.prompt}”
                </p>
              </Card.Body>
            </Card>
          )}
        </Match>
        <Match when={props.idea.kind === 'entity' && props.idea.draft} keyed>
          {(draft) => (
            <Card variant="filled" offset={1}>
              <Card.Body
                class="px-3 py-2"
                role="note"
                aria-label={t('ideas.draftReply')}
                data-idea-draft
              >
                <props.parts.Draft draft={draft} />
              </Card.Body>
            </Card>
          )}
        </Match>
      </Switch>
    </Show>
  );
}

/** Whether the card has a block, a failure or a note to show in its body. */
function hasBody(props: IdeaCardProps) {
  const waiting = props.status === 'open' || props.status === 'failed';
  const block =
    waiting &&
    (backgroundIdea(props.idea) !== undefined ||
      (props.idea.kind === 'entity' && props.idea.draft !== undefined));

  return block || props.failed || props.changed;
}

/** The quiet line beside the actions: when, where from, and what a run sends. */
function IdeaFacts(props: IdeaCardProps) {
  const background = () =>
    props.status === 'open' || props.status === 'failed'
      ? backgroundIdea(props.idea)
      : undefined;
  const [source] = props.idea.about;

  return (
    <Card.Metadata class="min-w-0 flex-1 flex-nowrap">
      <Switch>
        <Match when={background()} keyed>
          {(run) => (
            <span class="flex min-w-0 items-center gap-1.5">
              <PaperPlaneIcon
                class="size-3.5 shrink-0"
                classList={{ 'text-warning': !!run.sends }}
              />
              <span class="truncate" data-idea-sends>
                {run.sends ?? t('ideas.sendsNothing')}
              </span>
            </span>
          )}
        </Match>
        <Match when={props.idea.kind === 'routine' && props.routine} keyed>
          {(text) => (
            <span class="flex min-w-0 items-center gap-1.5">
              <LightningIcon class="size-3.5 shrink-0 text-violet-ink" />
              <span class="truncate">{text.when}</span>
            </span>
          )}
        </Match>
        <Match when={true}>
          <Show when={ideaTime(props.idea, props.status)}>
            {(time) => (
              <span class="shrink-0" data-idea-time>
                <Show
                  when={replyThread(props.idea, props.status)}
                  fallback={time()}
                >
                  {(thread) => (
                    <props.parts.Waiting thread={thread()} fallback={time()} />
                  )}
                </Show>
              </span>
            )}
          </Show>
          <Show when={props.status === 'open' && source}>
            {(target) => (
              <props.parts.Source
                target={target()}
                onOpen={() => props.onOpenSource(target())}
              />
            )}
          </Show>
        </Match>
      </Switch>
    </Card.Metadata>
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
    <Card.Actions>
      <Show
        when={props.status !== 'running'}
        fallback={
          <Button variant="secondary" size="sm" onClick={props.onOpen}>
            {t('ideas.viewProgress')}
          </Button>
        }
      >
        <Show when={props.idea.kind === 'routine'}>
          <Button variant="ghost" size="sm" onClick={props.onReview}>
            {t('ideas.review')}
          </Button>
        </Show>
        <Show when={background() && props.status === 'open'}>
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
      </Show>
    </Card.Actions>
  );
}

/**
 * One idea that waits or runs: what it is and why, the one thing to read
 * before acting when there is one, then a quiet line of facts and the action.
 */
export function IdeaCard(props: IdeaCardProps) {
  return (
    <IdeaSurface idea={props.idea} status={props.status}>
      <Card.Header class="pb-2">
        <Item class="items-start gap-2.5 border-0 p-0">
          <IdeaTile idea={props.idea} />
          <Item.Content class="gap-0.5 pt-1">
            <div class="flex min-w-0 items-center gap-2">
              <Show when={props.isNew}>
                <span
                  class="size-1.5 shrink-0 rounded-full bg-violet"
                  role="img"
                  aria-label={t('ideas.newIdea')}
                />
              </Show>
              <Card.Title
                id={`idea-title-${props.idea.id}`}
                role="heading"
                aria-level={2}
                class="truncate"
              >
                {props.idea.title}
              </Card.Title>
              <StateBadge idea={props.idea} status={props.status} />
            </div>
            <IdeaSentence {...props} />
          </Item.Content>
          <Item.Actions>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('ideas.dismissIdea', { title: props.idea.title })}
              tooltip={t('ideas.dismiss')}
              onClick={props.onDismiss}
            >
              <CloseIcon class="size-4" />
            </Button>
          </Item.Actions>
        </Item>
      </Card.Header>
      <Show when={hasBody(props)}>
        <Card.Body class={`flex flex-col gap-2 pt-0 pb-2 ${UNDER_TITLE}`}>
          <IdeaBlock {...props} />
          <Show when={props.failed}>
            <p role="alert" class="text-failure">
              {t('ideas.actionFailed')}
            </p>
          </Show>
          <Show when={props.changed}>
            <p role="status" class="text-ink-muted" data-idea-changed>
              {t('ideas.ideaChanged')}
            </p>
          </Show>
        </Card.Body>
      </Show>
      <Card.Footer class={`flex-nowrap border-0 pt-0 ${UNDER_TITLE}`}>
        <IdeaFacts {...props} />
        <CardActions {...props} />
      </Card.Footer>
    </IdeaSurface>
  );
}

/** A finished idea: one quiet line and how to open what it left. */
export function DoneIdeaRow(props: { idea: Idea; onOpen(): void }) {
  const openLabel = () => {
    const idea = props.idea;
    if (idea.kind === 'routine') return t('ideas.openRoutine');
    if (backgroundIdea(idea)) return t('ideas.openResult');
    if (idea.kind === 'entity' && idea.draft) return t('ideas.openDraft');
    if (idea.about[0]?.entityType === 'email_thread') {
      return t('ideas.openThread');
    }

    return t('ideas.openItem');
  };

  return (
    <IdeaSurface idea={props.idea} status="done">
      <Item size="sm" class="items-center gap-2.5 border-0 px-3">
        <IdeaTile idea={props.idea} finished />
        <Item.Content class="flex-row items-baseline gap-2">
          <Card.Title
            id={`idea-title-${props.idea.id}`}
            role="heading"
            aria-level={2}
            class="truncate font-normal text-ink-muted"
          >
            <Show
              when={props.idea.kind === 'routine'}
              fallback={props.idea.title}
            >
              <span class="font-medium text-ink">{props.idea.title}</span>{' '}
              {t('ideas.routineIsOn')}
            </Show>
          </Card.Title>
          <Card.Metadata class="shrink-0" data-idea-time>
            {formatRelativeTimestamp(props.idea.stateChangedAt, {
              condensed: true,
            })}
          </Card.Metadata>
        </Item.Content>
        <Item.Actions>
          <Button variant="ghost" size="sm" onClick={props.onOpen}>
            {openLabel()}
          </Button>
        </Item.Actions>
      </Item>
    </IdeaSurface>
  );
}

/** A dismissed idea, until the person leaves: one line and Undo. */
export function DismissedIdea(props: { idea: Idea; onUndo(): void }) {
  return (
    <Card class="border-dashed" data-idea-dismissed={props.idea.id}>
      <Item size="sm" class="items-center gap-2.5 border-0 px-3">
        <Item.Icon class="self-center text-ink-muted" aria-hidden="true">
          <EyeSlashIcon />
        </Item.Icon>
        <Item.Content>
          <Card.Description class="truncate">
            {t('ideas.dismissed', { title: props.idea.title })}
          </Card.Description>
        </Item.Content>
        <Item.Actions>
          <Button variant="ghost" size="sm" onClick={props.onUndo}>
            {t('ideas.undo')}
          </Button>
        </Item.Actions>
      </Item>
    </Card>
  );
}
