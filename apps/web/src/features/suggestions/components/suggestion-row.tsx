import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Card, Item, Spinner } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { SuggestionItemParts } from '../context/suggestions-source';
import type {
  RoutineText,
  Suggestion,
  SuggestionStatus,
  SuggestionTarget,
} from '../core/suggestion';
import { SuggestionGlyph } from './suggestion-tile';
import { waitingLabel } from './waiting';

export type SuggestionRowProps = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  isNew: boolean;
  busy: boolean;
  failed: boolean;
  /** It was rewritten since the row showed it; the action took nothing up. */
  changed: boolean;
  /** Its details are open: where it comes from, its draft, its other actions. */
  expanded: boolean;
  parts: SuggestionItemParts;
  onToggle(): void;
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

/** A reply draft's text, while the suggestion still waits for the person. */
function draftPreview(props: SuggestionRowProps): string | undefined {
  if (props.status !== 'open' || props.suggestion.kind !== 'entity') {
    return undefined;
  }

  return props.suggestion.draft?.preview;
}

/** What stands before a row's title: its kind, or how its run is going. */
function StateMark(props: {
  suggestion: Suggestion;
  status: SuggestionStatus;
}) {
  return (
    <Switch fallback={<SuggestionGlyph suggestion={props.suggestion} />}>
      <Match when={props.status === 'running'}>
        <Spinner size="sm" decorative />
      </Match>
      <Match when={props.status === 'failed'}>
        <WarningIcon class="text-failure" />
      </Match>
    </Switch>
  );
}

const PICKED_MARK_MAX = 32;

/** A routine's sentence, with the short values AI picked in violet. */
function RoutineSentence(props: { text: RoutineText }) {
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
 * The one line under the title: why the suggestion matters; for a routine,
 * what it will do; for a failed run, that it failed. A background run's
 * prompt is not shown: its summary says what will be done, and Open in chat
 * shows the prompt itself. One line until the row is opened.
 */
function SuggestionSentence(props: SuggestionRowProps) {
  const sentence = () =>
    props.suggestion.kind === 'routine' &&
    props.suggestion.routine?.sentence.some((part) => part.text.trim())
      ? props.suggestion.routine
      : undefined;

  return (
    <Item.Description class={props.expanded ? undefined : 'truncate'}>
      <Switch fallback={props.suggestion.summary}>
        <Match when={props.status === 'failed'}>
          {t('suggestions.runFailed')}
        </Match>
        <Match when={sentence()} keyed>
          {(text) => <RoutineSentence text={text} />}
        </Match>
      </Switch>
    </Item.Description>
  );
}

/** What a background run will post or send, shown before it can be run. */
function SuggestionSends(props: SuggestionRowProps) {
  const waiting = () =>
    props.status === 'open' || props.status === 'failed'
      ? backgroundSuggestion(props.suggestion)
      : undefined;

  return (
    <Show when={waiting()} keyed>
      {(run) => (
        <Item.Metadata class="flex-nowrap gap-x-1.5 pt-0.5">
          <PaperPlaneIcon class="size-3.5 shrink-0" />
          <span class="truncate" data-suggestion-sends>
            {run.sends ?? t('suggestions.sendsNothing')}
          </span>
        </Item.Metadata>
      )}
    </Show>
  );
}

/** When the suggestion arrived, or its run started, in words. */
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

  return formatRelativeTimestamp(suggestion.createdAt, { condensed: true });
}

/** The quiet fact above the action: how long it has waited, when a routine runs, or that its run failed. */
function SuggestionFact(props: SuggestionRowProps) {
  return (
    <Item.Metadata class="flex-nowrap gap-x-1.5">
      <Switch>
        <Match when={props.status === 'failed'}>
          <span class="text-failure">{t('suggestions.badgeFailed')}</span>
        </Match>
        <Match
          when={props.suggestion.kind === 'routine' && props.suggestion.routine}
          keyed
        >
          {(text) => (
            <>
              <LightningIcon class="size-3.5 shrink-0" />
              <span>{text.when}</span>
            </>
          )}
        </Match>
        {/* A routine suggestion is not about a moment. */}
        <Match when={props.suggestion.kind !== 'routine'}>
          <Show when={suggestionTime(props.suggestion, props.status)}>
            {(time) => (
              <span data-suggestion-time>
                {waitingLabel(props.suggestion) ?? time()}
              </span>
            )}
          </Show>
        </Match>
      </Switch>
    </Item.Metadata>
  );
}

/** The row's one action: what taking the suggestion up means for its kind. */
function RowAction(props: SuggestionRowProps): JSX.Element {
  const drafted = () =>
    props.suggestion.kind === 'entity' && !!props.suggestion.draft;
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

  return (
    <Show
      when={props.status !== 'running'}
      fallback={
        <Button variant="link" size="sm" class="-mr-2" onClick={props.onOpen}>
          {t('suggestions.viewProgress')}
        </Button>
      }
    >
      <Button
        variant="link"
        size="sm"
        class="-mr-2"
        loading={props.busy}
        onClick={props.onAccept}
        data-suggestion-accept
      >
        <Show when={drafted()}>
          <PencilIcon class="size-3.5" />
        </Show>
        {acceptLabel()}
      </Button>
    </Show>
  );
}

/** What an opened row adds: where it comes from, its draft, and its other actions. */
function RowDetails(props: SuggestionRowProps) {
  const source = () => props.suggestion.about[0];
  const background = () => backgroundSuggestion(props.suggestion);

  return (
    <div class="flex flex-col items-start gap-2 pt-2">
      <Show when={props.status === 'open' && source()}>
        {(target) => (
          <Item.Metadata class="max-w-full flex-nowrap">
            <props.parts.Source
              target={target()}
              from={
                props.suggestion.kind === 'entity'
                  ? props.suggestion.from
                  : undefined
              }
              onOpen={() => props.onOpenSource(target())}
            />
          </Item.Metadata>
        )}
      </Show>
      <Show when={draftPreview(props)}>
        {(preview) => (
          <Card variant="filled" offset={1} class="w-full">
            <Card.Body class="flex flex-col gap-1">
              <Card.Metadata class="text-violet-ink">
                {t('suggestions.replyDrafted')}
              </Card.Metadata>
              <p class="text-ink-muted" data-suggestion-draft>
                {preview()}
              </p>
            </Card.Body>
          </Card>
        )}
      </Show>
      <Show when={props.suggestion.kind === 'routine'}>
        <Button variant="secondary" size="sm" onClick={props.onReview}>
          {t('suggestions.review')}
        </Button>
      </Show>
      <Show when={background() && props.status === 'open'}>
        <Button variant="secondary" size="sm" onClick={props.onOpenInChat}>
          {t('suggestions.openInChat')}
        </Button>
      </Show>
    </div>
  );
}

/**
 * One suggestion that waits or runs, as a row: its kind or state, what it is
 * and why in one line, then a quiet fact over its one action. Pressing the
 * text opens its details in place.
 */
export function SuggestionRow(props: SuggestionRowProps) {
  const titleId = () => `suggestion-title-${props.suggestion.id}`;
  const detailsId = () => `suggestion-details-${props.suggestion.id}`;

  return (
    <Item
      variant={props.expanded ? 'filled' : 'ghost'}
      depth={props.expanded ? 3 : undefined}
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status={props.status}
      class="group/suggestion items-start"
    >
      <Item.Icon aria-hidden="true">
        <StateMark suggestion={props.suggestion} status={props.status} />
      </Item.Icon>
      <Item.Content class="gap-0">
        <button
          type="button"
          class="flex min-w-0 flex-col rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
          aria-expanded={props.expanded}
          aria-controls={detailsId()}
          onClick={props.onToggle}
        >
          <span class="flex min-w-0 items-center gap-2">
            <Show when={props.isNew}>
              <span
                class="size-1.5 shrink-0 rounded-full bg-violet"
                role="img"
                aria-label={t('suggestions.newSuggestion')}
              />
            </Show>
            <Item.Title id={titleId()} class="font-medium">
              {props.suggestion.title}
            </Item.Title>
          </span>
          <SuggestionSentence {...props} />
        </button>
        <SuggestionSends {...props} />
        <Show when={props.failed}>
          <p role="alert" class="pt-1 text-sm text-failure">
            {t('suggestions.actionFailed')}
          </p>
        </Show>
        <Show when={props.changed}>
          <p
            role="status"
            class="pt-1 text-sm text-ink-muted"
            data-suggestion-changed
          >
            {t('suggestions.suggestionChanged')}
          </p>
        </Show>
        <div id={detailsId()}>
          <Show when={props.expanded}>
            <RowDetails {...props} />
          </Show>
        </div>
      </Item.Content>
      <div class="flex shrink-0 flex-col items-end">
        <div class="flex h-6 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            class="opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100"
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
            <CloseIcon class="size-3.5" />
          </Button>
          <SuggestionFact {...props} />
        </div>
        <RowAction {...props} />
      </div>
    </Item>
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
  const titleId = () => `suggestion-title-${props.suggestion.id}`;

  return (
    <Item
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status="done"
      class="items-center py-2"
    >
      <Item.Icon class="self-center text-ink-extra-muted" aria-hidden="true">
        <CheckIcon />
      </Item.Icon>
      <Item.Content>
        <Item.Title id={titleId()} class="font-normal text-ink-muted">
          <Show
            when={props.suggestion.kind === 'routine'}
            fallback={props.suggestion.title}
          >
            <span class="font-medium text-ink">{props.suggestion.title}</span>{' '}
            {t('suggestions.routineIsOn')}
          </Show>
        </Item.Title>
      </Item.Content>
      <Item.Metadata class="shrink-0" data-suggestion-time>
        {formatRelativeTimestamp(props.suggestion.stateChangedAt, {
          condensed: true,
        })}
      </Item.Metadata>
      <Button variant="link" size="sm" class="-mr-2" onClick={props.onOpen}>
        {openLabel()}
      </Button>
    </Item>
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
    <Item
      class="items-center py-2"
      data-suggestion-dismissed={props.suggestion.id}
    >
      <Item.Icon class="self-center text-ink-extra-muted" aria-hidden="true">
        <EyeSlashIcon />
      </Item.Icon>
      <Item.Content>
        <Item.Description>
          {t(
            props.wasRunning
              ? 'suggestions.dismissedAndStopped'
              : 'suggestions.dismissed',
            { title: props.suggestion.title }
          )}
        </Item.Description>
        <Show when={props.failed}>
          <Item.Metadata role="alert" class="text-failure">
            {t('suggestions.undoFailed')}
          </Item.Metadata>
        </Show>
      </Item.Content>
      <Button
        variant="link"
        size="sm"
        class="-mr-2"
        loading={props.busy}
        onClick={props.onUndo}
      >
        {t('suggestions.undo')}
      </Button>
    </Item>
  );
}
