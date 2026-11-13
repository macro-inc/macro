import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Badge, Button, Card, Item, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type {
  RoutineCardText,
  SuggestionItemParts,
} from '../context/suggestions-source';
import type {
  Suggestion,
  SuggestionStatus,
  SuggestionTarget,
} from '../core/suggestion';
import { SuggestionTile } from './suggestion-tile';
import { waitingLabel } from './waiting';

export type SuggestionCardProps = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  /** It was rewritten since the card showed it; the action took nothing up. */
  changed: boolean;
  routine?: RoutineCardText;
  parts: SuggestionItemParts;
  onAccept(): void;
  onOpen(): void;
  /** Put a prompt suggestion's prompt in the composer, to edit before running. */
  onOpenInChat(): void;
  onOpenSource(target: SuggestionTarget): void;
  onReview(): void;
  onDismiss(): void;
};

type BackgroundSuggestion = Extract<Suggestion, { runMode: 'background' }>;

function backgroundSuggestion(
  suggestion: Suggestion
): BackgroundSuggestion | undefined {
  return suggestion.kind === 'prompt' && suggestion.runMode === 'background'
    ? suggestion
    : undefined;
}

function StateBadge(props: {
  suggestion: Suggestion;
  status: SuggestionStatus;
}) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Badge variant="accent" size="xs">
          <Spinner size="sm" decorative class="size-3" />
          {t('suggestions.badgeRunning')}
        </Badge>
      </Match>
      <Match when={props.status === 'failed'}>
        <Badge variant="secondary" size="xs">
          <WarningIcon class="size-3 text-failure" />
          {t('suggestions.badgeFailed')}
        </Badge>
      </Match>
      <Match when={props.status === 'done'}>
        <Badge variant="success" size="xs">
          <CheckIcon class="size-3" />
          {t('suggestions.badgeDone')}
        </Badge>
      </Match>
      <Match when={props.suggestion.kind === 'routine'}>
        <Badge variant="violet" size="xs">
          {t('suggestions.badgeRoutine')}
        </Badge>
      </Match>
    </Switch>
  );
}

/** When the suggestion arrived, its run started, or it finished, in words. */
function suggestionTime(
  suggestion: Suggestion,
  status: SuggestionStatus
): string | undefined {
  if (status === 'running') {
    const startedAt = backgroundSuggestion(suggestion)?.run?.startedAt;
    if (!startedAt) return undefined;

    return t('suggestions.started', {
      when: formatRelativeTimestamp(startedAt, { condensed: true }),
    });
  }
  if (status === 'done') {
    return formatRelativeTimestamp(suggestion.stateChangedAt, {
      condensed: true,
    });
  }
  // A routine suggestion is not about a moment.
  if (suggestion.kind === 'routine') return undefined;

  return formatRelativeTimestamp(suggestion.createdAt, { condensed: true });
}

/** The app's card for one suggestion: the same surface the routine cards use. */
function SuggestionSurface(props: {
  suggestion: Suggestion;
  status: SuggestionStatus;
  children: JSX.Element;
}) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="article"
      aria-labelledby={`suggestion-title-${props.suggestion.id}`}
      data-suggestion={props.suggestion.id}
      data-suggestion-status={props.status}
      class="group/suggestion"
    >
      {props.children}
    </Card>
  );
}

/** Lines up a card's body and footer under its title, past the tile. */
const UNDER_TITLE = 'pl-12.5';

const PICKED_MARK_MAX = 32;

/** A routine's sentence, with the short values AI picked in violet. */
function RoutineSentence(props: { text: RoutineCardText }) {
  return (
    <For each={props.text.sentence}>
      {(part) => (
        // A long picked value, such as a whole message, stays plain: a
        // sentence that is mostly violet stops being quiet.
        <Show
          when={part.picked && part.text.length <= PICKED_MARK_MAX}
          fallback={part.text}
        >
          <span class="font-medium text-violet-ink">{part.text}</span>
        </Show>
      )}
    </For>
  );
}

/**
 * The one block of text under the title, never two that repeat each other:
 * why the suggestion matters; for a routine, what it will do; for a drafted
 * reply, the draft; for a failed run, that it failed. A background run's
 * prompt is not shown: its summary says what will be done, and Open in chat
 * shows the prompt itself.
 */
function SuggestionSentence(props: SuggestionCardProps) {
  const sentence = () =>
    props.suggestion.kind === 'routine' &&
    props.routine?.sentence.some((part) => part.text.trim())
      ? props.routine
      : undefined;

  return (
    <Switch>
      <Match when={props.status === 'failed'}>
        <Card.Description>{t('suggestions.runFailed')}</Card.Description>
      </Match>
      <Match when={sentence()} keyed>
        {(text) => (
          <Card.Description class="line-clamp-2">
            <RoutineSentence text={text} />
          </Card.Description>
        )}
      </Match>
      <Match
        when={
          props.status === 'open' &&
          props.suggestion.kind === 'entity' &&
          props.suggestion.draft
        }
        keyed
      >
        {(draft) => (
          <Card.Description class="line-clamp-2" data-suggestion-draft>
            {draft.preview ? `“${draft.preview}”` : props.suggestion.summary}
          </Card.Description>
        )}
      </Match>
      <Match when={props.suggestion.summary}>
        <Card.Description
          class={props.status === 'running' ? 'line-clamp-1' : 'line-clamp-2'}
        >
          {props.suggestion.summary}
        </Card.Description>
      </Match>
    </Switch>
  );
}

/** The quiet line beside the actions: when, where from, and what a run sends. */
function SuggestionFacts(props: SuggestionCardProps) {
  const background = () =>
    props.status === 'open' || props.status === 'failed'
      ? backgroundSuggestion(props.suggestion)
      : undefined;
  const [source] = props.suggestion.about;

  return (
    <Card.Metadata class="min-w-0 flex-1 flex-nowrap">
      <Switch>
        <Match when={background()} keyed>
          {(run) => (
            <span class="flex min-w-0 items-center gap-1.5">
              <PaperPlaneIcon class="size-3.5 shrink-0" />
              <span class="truncate" data-suggestion-sends>
                {run.sends ?? t('suggestions.sendsNothing')}
              </span>
            </span>
          )}
        </Match>
        <Match
          when={props.suggestion.kind === 'routine' && props.routine}
          keyed
        >
          {(text) => (
            <span class="flex min-w-0 items-center gap-1.5">
              <LightningIcon class="size-3.5 shrink-0" />
              <span class="truncate">{text.when}</span>
            </span>
          )}
        </Match>
        <Match when={true}>
          <Show when={suggestionTime(props.suggestion, props.status)}>
            {(time) => (
              <span class="shrink-0" data-suggestion-time>
                {waitingLabel(props.suggestion) ?? time()}
              </span>
            )}
          </Show>
          <Show when={props.status === 'open' && source}>
            {(target) => (
              <props.parts.Source
                target={target()}
                from={
                  props.suggestion.kind === 'entity'
                    ? props.suggestion.from
                    : undefined
                }
                onOpen={() => props.onOpenSource(target())}
              />
            )}
          </Show>
        </Match>
      </Switch>
    </Card.Metadata>
  );
}

function CardActions(props: SuggestionCardProps): JSX.Element {
  const acceptLabel = () => {
    const suggestion = props.suggestion;
    if (suggestion.kind === 'routine') return t('suggestions.turnOn');
    if (suggestion.kind === 'entity') {
      return suggestion.draft
        ? t('suggestions.openDraft')
        : t('suggestions.openItem');
    }
    if (suggestion.runMode === 'composer') return t('suggestions.openInChat');

    return props.status === 'failed'
      ? t('suggestions.runAgain')
      : t('suggestions.runInBackground');
  };
  const background = () => backgroundSuggestion(props.suggestion);

  return (
    <Card.Actions>
      <Show
        when={props.status !== 'running'}
        fallback={
          <Button variant="ghost" size="sm" onClick={props.onOpen}>
            {t('suggestions.viewProgress')}
          </Button>
        }
      >
        <Show when={props.suggestion.kind === 'routine'}>
          <Button variant="ghost" size="sm" onClick={props.onReview}>
            {t('suggestions.review')}
          </Button>
        </Show>
        <Show when={background() && props.status === 'open'}>
          <Button variant="ghost" size="sm" onClick={props.onOpenInChat}>
            {t('suggestions.openInChat')}
          </Button>
        </Show>
        <Button
          variant="secondary"
          size="sm"
          loading={props.busy}
          onClick={props.onAccept}
          data-suggestion-accept
        >
          {acceptLabel()}
        </Button>
      </Show>
    </Card.Actions>
  );
}

/**
 * One suggestion that waits or runs: what it is and why, the one thing to read
 * before acting when there is one, then a quiet line of facts and the action.
 */
export function SuggestionCard(props: SuggestionCardProps) {
  return (
    <SuggestionSurface suggestion={props.suggestion} status={props.status}>
      <Card.Header class="pb-2">
        <Item class="items-start gap-2.5 border-0 p-0">
          <SuggestionTile suggestion={props.suggestion} />
          <Item.Content class="gap-0.5 pt-1">
            <div class="flex min-w-0 items-center gap-2">
              <Show when={props.isNew}>
                <span
                  class="size-1.5 shrink-0 rounded-full bg-violet"
                  role="img"
                  aria-label={t('suggestions.newSuggestion')}
                />
              </Show>
              <Card.Title
                id={`suggestion-title-${props.suggestion.id}`}
                role="heading"
                aria-level={2}
                class="truncate"
              >
                {props.suggestion.title}
              </Card.Title>
              <StateBadge suggestion={props.suggestion} status={props.status} />
            </div>
            <SuggestionSentence {...props} />
          </Item.Content>
          <Item.Actions class="opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(
                props.status === 'running'
                  ? 'suggestions.stopAndDismissSuggestion'
                  : 'suggestions.dismissSuggestion',
                { title: props.suggestion.title }
              )}
              tooltip={t(
                props.status === 'running'
                  ? 'suggestions.stopAndDismiss'
                  : 'suggestions.dismiss'
              )}
              onClick={props.onDismiss}
            >
              <CloseIcon class="size-4" />
            </Button>
          </Item.Actions>
        </Item>
      </Card.Header>
      <Show when={props.failed || props.changed}>
        <Card.Body class={`flex flex-col gap-2 pt-0 pb-2 ${UNDER_TITLE}`}>
          <Show when={props.failed}>
            <p role="alert" class="text-failure">
              {t('suggestions.actionFailed')}
            </p>
          </Show>
          <Show when={props.changed}>
            <p role="status" class="text-ink-muted" data-suggestion-changed>
              {t('suggestions.suggestionChanged')}
            </p>
          </Show>
        </Card.Body>
      </Show>
      <Card.Footer class={`flex-nowrap border-0 pt-0 ${UNDER_TITLE}`}>
        <SuggestionFacts {...props} />
        <CardActions {...props} />
      </Card.Footer>
    </SuggestionSurface>
  );
}

/** A finished suggestion: one quiet line and how to open what it left. */
export function DoneSuggestionRow(props: {
  suggestion: Suggestion;
  onOpen(): void;
}) {
  const openLabel = () => {
    const suggestion = props.suggestion;
    if (suggestion.kind === 'routine') return t('suggestions.openRoutine');
    if (backgroundSuggestion(suggestion)) return t('suggestions.openResult');
    if (suggestion.kind === 'entity' && suggestion.draft)
      return t('suggestions.openDraft');
    if (suggestion.about[0]?.entityType === 'email_thread') {
      return t('suggestions.openThread');
    }

    return t('suggestions.openItem');
  };

  return (
    <SuggestionSurface suggestion={props.suggestion} status="done">
      <Item size="sm" class="items-center gap-2.5 border-0 px-3">
        <SuggestionTile suggestion={props.suggestion} finished />
        <Item.Content class="flex-row items-baseline gap-2">
          <Card.Title
            id={`suggestion-title-${props.suggestion.id}`}
            role="heading"
            aria-level={2}
            class="truncate font-normal text-ink-muted"
          >
            <Show
              when={props.suggestion.kind === 'routine'}
              fallback={props.suggestion.title}
            >
              <span class="font-medium text-ink">{props.suggestion.title}</span>{' '}
              {t('suggestions.routineIsOn')}
            </Show>
          </Card.Title>
          <Card.Metadata class="shrink-0" data-suggestion-time>
            {formatRelativeTimestamp(props.suggestion.stateChangedAt, {
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
    </SuggestionSurface>
  );
}

/** A dismissed suggestion, until the person leaves: one line and Undo. */
export function DismissedSuggestion(props: {
  suggestion: Suggestion;
  /** Its run was under way: dismissing stops it. */
  wasRunning: boolean;
  /** Undo is under way. */
  busy: boolean;
  /** The server refused to bring it back. */
  failed: boolean;
  onUndo(): void;
}) {
  return (
    <Card class="border-dashed" data-suggestion-dismissed={props.suggestion.id}>
      <Item size="sm" class="items-center gap-2.5 border-0 px-3">
        <Item.Icon class="self-center text-ink-muted" aria-hidden="true">
          <EyeSlashIcon />
        </Item.Icon>
        <Item.Content>
          <Card.Description class="truncate">
            {t(
              props.wasRunning
                ? 'suggestions.dismissedAndStopped'
                : 'suggestions.dismissed',
              { title: props.suggestion.title }
            )}
          </Card.Description>
          <Show when={props.failed}>
            <Card.Metadata role="alert" class="text-failure">
              {t('suggestions.undoFailed')}
            </Card.Metadata>
          </Show>
        </Item.Content>
        <Item.Actions>
          <Button
            variant="ghost"
            size="sm"
            loading={props.busy}
            onClick={props.onUndo}
          >
            {t('suggestions.undo')}
          </Button>
        </Item.Actions>
      </Item>
    </Card>
  );
}
