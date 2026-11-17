import { formatRelativeTimestamp } from '@app/features/entity/utils/timestamp';
import { t } from '@app/lib/i18n';
import CaretUpIcon from '@icon/system/regular/caret-up.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Card, cn, Item, Spinner } from '@ui';
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
  busy: boolean;
  failed: boolean;
  /** It was rewritten since the row showed it; the action took nothing up. */
  changed: boolean;
  /** Its details are open: where it comes from, its draft, its actions. */
  expanded: boolean;
  parts: SuggestionItemParts;
  onToggle(): void;
  onAccept(): void;
  /** Take it up without opening anything: the person has dealt with it. */
  onMarkDone(): void;
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

/**
 * Taking it up is all there is to do: an item to open or a prompt to take
 * to the composer. A background prompt runs and a routine is saved instead.
 */
function finishesWhenTaken(suggestion: Suggestion): boolean {
  return (
    suggestion.kind === 'entity' ||
    (suggestion.kind === 'prompt' && suggestion.runMode === 'composer')
  );
}

/** A background run that still waits for Run, with what it will send. */
function waitingRun(props: SuggestionRowProps) {
  return props.status === 'open' || props.status === 'failed'
    ? backgroundSuggestion(props.suggestion)
    : undefined;
}

/**
 * What a run will post or send, as a line of its own: it must be on the row
 * before Run. A run that sends nothing says so beside Run instead, unless
 * that place holds its failure.
 */
function sendsLine(props: SuggestionRowProps): string | undefined {
  const run = waitingRun(props);
  if (!run) return undefined;
  if (run.sends) return run.sends;

  return props.status === 'failed' ? t('suggestions.sendsNothing') : undefined;
}

/** A reply draft's text, while the suggestion still waits for the person. */
function draftPreview(props: SuggestionRowProps): string | undefined {
  if (props.status !== 'open' || props.suggestion.kind !== 'entity') {
    return undefined;
  }

  return props.suggestion.draft?.preview;
}

/** What taking the suggestion up is called for its kind. */
function acceptLabel(props: SuggestionRowProps, short: boolean): string {
  const suggestion = props.suggestion;
  if (suggestion.kind === 'routine') return t('suggestions.turnOn');
  if (suggestion.kind === 'entity') {
    return suggestion.draft
      ? t('suggestions.openDraft')
      : t('suggestions.openItem');
  }
  if (suggestion.runMode === 'composer') return t('suggestions.openInChat');
  if (props.status === 'failed') return t('suggestions.runAgain');

  return short ? t('suggestions.run') : t('suggestions.runInBackground');
}

/**
 * What stands before a row's title: a circle that marks it done where taking
 * it up is all there is to do, else what pressing its action starts, or how
 * its run is going.
 */
function RowLead(props: SuggestionRowProps) {
  return (
    <Switch>
      <Match when={props.status === 'running'}>
        <Spinner size="sm" decorative />
      </Match>
      <Match when={props.status === 'failed'}>
        <span class="flex size-4.5 items-center justify-center rounded-full bg-failure-bg">
          <ExclamationIcon class="size-3 text-failure" />
        </span>
      </Match>
      <Match when={props.suggestion.kind === 'routine'}>
        <RepeatIcon class="size-4.5 text-orange" />
      </Match>
      <Match when={backgroundSuggestion(props.suggestion)}>
        <span class="flex size-4.5 items-center justify-center rounded-full border-[1.5px] border-ink-extra-muted">
          <PlayIcon class="size-2.5 text-ink-muted" />
        </span>
      </Match>
      <Match when={finishesWhenTaken(props.suggestion)}>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={props.busy}
          aria-label={t('suggestions.markDoneSuggestion', {
            title: props.suggestion.title,
          })}
          tooltip={t('suggestions.markDone')}
          onClick={props.onMarkDone}
        >
          <CircleIcon class="size-5 text-ink-extra-muted" />
        </Button>
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

/** When the suggestion arrived, or its run started, in words. */
function suggestionTime(props: SuggestionRowProps): string {
  const startedAt = backgroundSuggestion(props.suggestion)?.run?.startedAt;
  if (props.status === 'running' && startedAt) {
    return t('suggestions.started', {
      when: formatRelativeTimestamp(startedAt, { condensed: true }),
    });
  }

  return (
    waitingLabel(props.suggestion) ??
    formatRelativeTimestamp(props.suggestion.createdAt, { condensed: true })
  );
}

function DismissButton(props: SuggestionRowProps & { size: 'xs' | 'sm' }) {
  return (
    <Button
      variant="ghost"
      size={props.size === 'xs' ? 'icon-xs' : 'icon-sm'}
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
  );
}

/** A quiet line of the row's right side: muted, one line high. */
function LaneFact(props: { children: JSX.Element }) {
  return (
    <span class="flex h-6 items-center gap-1.5 whitespace-nowrap text-sm text-ink-extra-muted">
      {props.children}
    </span>
  );
}

/**
 * The right side of a row whose taking up opens something: what kind it is
 * and how long it has waited, with Draft ready under it. Pointing at the row
 * or focusing in it swaps these for Open and dismiss.
 */
function OpenLane(props: SuggestionRowProps) {
  const drafted = () =>
    props.suggestion.kind === 'entity' && !!props.suggestion.draft;

  return (
    <div class="relative flex min-h-12 min-w-36 shrink-0 flex-col items-end">
      <div class="flex flex-col items-end transition-opacity group-focus-within/suggestion:opacity-0 not-touch:group-hover/suggestion:opacity-0">
        <LaneFact>
          <SuggestionGlyph suggestion={props.suggestion} small />
          <span data-suggestion-time>{suggestionTime(props)}</span>
        </LaneFact>
        <Show when={drafted()}>
          <span class="flex h-5 items-center gap-1.5 text-sm font-medium text-violet-ink">
            <PencilIcon class="size-3" />
            {t('suggestions.draftReady')}
          </span>
        </Show>
      </div>
      <div class="absolute top-0 right-0 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
        <Button
          variant="secondary"
          size="sm"
          loading={props.busy}
          onClick={props.onAccept}
          data-suggestion-accept
        >
          {acceptLabel(props, true)}
        </Button>
        <DismissButton {...props} size="sm" />
      </div>
    </div>
  );
}

/**
 * The right side of a row that runs something: a fact (what it sends, when
 * it started, that it failed) over its action, always in view since pressing
 * it is the approval.
 */
function RunLane(props: SuggestionRowProps) {
  return (
    <div class="flex min-h-12 shrink-0 flex-col items-end">
      <div class="flex items-center gap-1">
        <span class="opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
          <DismissButton {...props} size="xs" />
        </span>
        <Switch
          fallback={
            <LaneFact>
              <span data-suggestion-time>{suggestionTime(props)}</span>
            </LaneFact>
          }
        >
          <Match when={props.status === 'failed'}>
            <span class="flex h-6 items-center text-sm text-failure">
              {t('suggestions.badgeFailed')}
            </span>
          </Match>
          <Match when={props.suggestion.kind === 'routine'}>
            <LaneFact>{t('suggestions.badgeRoutine')}</LaneFact>
          </Match>
          <Match when={props.status === 'open' && !waitingRun(props)?.sends}>
            <LaneFact>
              <PaperPlaneIcon class="size-3.5 shrink-0" />
              <span data-suggestion-sends>{t('suggestions.sendsNothing')}</span>
            </LaneFact>
          </Match>
        </Switch>
      </div>
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
          {acceptLabel(props, true)}
        </Button>
      </Show>
    </div>
  );
}

/** What an opened row adds: where it comes from, its draft, and its actions. */
function RowDetails(props: SuggestionRowProps) {
  const source = () => props.suggestion.about[0];

  return (
    <div class="flex flex-col gap-2.5 pt-2.5">
      <Show when={props.status === 'open' && source()}>
        {(target) => (
          <div class="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
            <props.parts.Source
              target={target()}
              from={
                props.suggestion.kind === 'entity'
                  ? props.suggestion.from
                  : undefined
              }
              onOpen={() => props.onOpenSource(target())}
            />
          </div>
        )}
      </Show>
      <Show when={draftPreview(props)}>
        {(preview) => (
          <Card variant="filled" offset={1}>
            <Card.Body class="flex flex-col gap-1.5">
              <span class="flex items-center gap-1.5 text-xs font-medium text-violet-ink">
                <PencilIcon class="size-3" />
                {t('suggestions.replyDrafted')}
              </span>
              <p class="text-base text-ink-muted" data-suggestion-draft>
                {preview()}
              </p>
            </Card.Body>
          </Card>
        )}
      </Show>
      <div class="flex items-center gap-1">
        <Show
          when={props.status !== 'running'}
          fallback={
            <Button variant="secondary" size="sm" onClick={props.onOpen}>
              {t('suggestions.viewProgress')}
            </Button>
          }
        >
          <Button
            variant="secondary"
            size="sm"
            loading={props.busy}
            onClick={props.onAccept}
            data-suggestion-accept
          >
            {acceptLabel(props, false)}
          </Button>
        </Show>
        <Show when={props.suggestion.kind === 'routine'}>
          <Button variant="ghost" size="sm" onClick={props.onReview}>
            {t('suggestions.review')}
          </Button>
        </Show>
        <Show
          when={
            backgroundSuggestion(props.suggestion) && props.status === 'open'
          }
        >
          <Button variant="ghost" size="sm" onClick={props.onOpenInChat}>
            {t('suggestions.openInChat')}
          </Button>
        </Show>
        <span class="ml-auto">
          <DismissButton {...props} size="sm" />
        </span>
      </div>
    </div>
  );
}

/**
 * One suggestion that waits or runs, as a row: what pressing it does, what
 * it is and why in one line, then a quiet fact on the right. Pressing the
 * text opens its details in place, with its actions.
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
      class={cn(
        'group/suggestion items-start',
        !props.expanded && 'not-touch:hover:bg-hover'
      )}
    >
      <Item.Icon class="h-6 w-6">
        <RowLead {...props} />
      </Item.Icon>
      <Item.Content class="gap-0">
        <button
          type="button"
          class="flex min-w-0 flex-col rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
          aria-expanded={props.expanded}
          aria-controls={detailsId()}
          onClick={props.onToggle}
        >
          <Item.Title id={titleId()} class="text-base leading-6 font-medium">
            {props.suggestion.title}
          </Item.Title>
          <SuggestionSentence {...props} />
        </button>
        <Show when={sendsLine(props)}>
          {(sends) => (
            <span class="flex min-w-0 items-center gap-1.5 pt-0.5 text-sm text-ink-extra-muted">
              <PaperPlaneIcon class="size-3.5 shrink-0" />
              <span class="truncate" data-suggestion-sends>
                {sends()}
              </span>
            </span>
          )}
        </Show>
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
      <Switch fallback={<RunLane {...props} />}>
        <Match when={props.expanded}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('suggestions.closeSuggestion', {
              title: props.suggestion.title,
            })}
            onClick={props.onToggle}
          >
            <CaretUpIcon class="size-3.5" />
          </Button>
        </Match>
        <Match
          when={props.status === 'open' && finishesWhenTaken(props.suggestion)}
        >
          <OpenLane {...props} />
        </Match>
      </Switch>
    </Item>
  );
}

/**
 * A finished suggestion and how to open what it left. The latest stands out;
 * the earlier ones are quiet.
 */
export function DoneSuggestionRow(props: {
  suggestion: Suggestion;
  quiet: boolean;
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
      class="items-start"
    >
      <Item.Icon class="h-6 w-6" aria-hidden="true">
        <span
          class={cn(
            'flex size-4.5 items-center justify-center rounded-full',
            props.quiet ? 'bg-ink/15' : 'bg-success-bg'
          )}
        >
          <CheckIcon
            class={cn(
              'size-3',
              props.quiet ? 'text-ink-muted' : 'text-success'
            )}
          />
        </span>
      </Item.Icon>
      <Item.Content class="gap-0">
        <Item.Title
          id={titleId()}
          class={cn(
            'text-base leading-6',
            props.quiet ? 'font-normal text-ink-muted' : 'font-medium'
          )}
        >
          <Show
            when={props.suggestion.kind === 'routine'}
            fallback={props.suggestion.title}
          >
            {props.suggestion.title} {t('suggestions.routineIsOn')}
          </Show>
        </Item.Title>
        <Show when={props.suggestion.summary}>
          <Item.Description
            class={cn('truncate', props.quiet && 'text-ink-extra-muted')}
          >
            {props.suggestion.summary}
          </Item.Description>
        </Show>
      </Item.Content>
      <div class="flex shrink-0 flex-col items-end">
        <LaneFact>
          <span data-suggestion-time>
            {formatRelativeTimestamp(props.suggestion.stateChangedAt, {
              condensed: true,
            })}
          </span>
        </LaneFact>
        <Button variant="link" size="sm" class="-mr-2" onClick={props.onOpen}>
          {openLabel()}
        </Button>
      </div>
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
    <Item class="items-center" data-suggestion-dismissed={props.suggestion.id}>
      <Item.Icon
        class="h-6 w-6 self-center text-ink-extra-muted"
        aria-hidden="true"
      >
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
          <span role="alert" class="text-sm text-failure">
            {t('suggestions.undoFailed')}
          </span>
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
