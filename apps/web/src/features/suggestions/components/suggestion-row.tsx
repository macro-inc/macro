import { t } from '@app/lib/i18n';
import { formatTime } from '@core/util/date';
import SparkleIcon from '@icon/system/fill/sparkle-fill.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, cn, Item, Spinner, Tooltip } from '@ui';
import {
  children,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { SuggestionItemParts } from '../context/suggestions-source';
import type { Suggestion, SuggestionStatus } from '../core/suggestion';
import { ageLabel, sinceLabel } from './waiting';

type RowState = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  /** Its action is under way. */
  busy: boolean;
  /** Its last action failed. */
  failed: boolean;
  /** It was rewritten since the row showed it; the action took nothing up. */
  changed: boolean;
  /** Rating the suggestion, shown with the row's buttons. */
  feedback?: JSX.Element;
  onDismiss(): void;
};

export type MacroRowProps = RowState & {
  /** Its button: run it, open its chat, or turn its routine on. */
  onAccept(): void;
  /** Pressing its text: look at what it would do before taking it up. */
  onLook(): void;
};

export type ToDoRowProps = RowState & {
  parts: SuggestionItemParts;
  /** Take it up and open its item or its draft. */
  onOpen(): void;
  /**
   * Take it up without opening anything: the person has dealt with it.
   * Absent for a reply, which is done once the person replies.
   */
  onMarkDone?: () => void;
};

/** Resolved children that put something on screen; a control that is off renders none. */
export function rendersSomething(resolved: unknown[]): boolean {
  return resolved.some((child) => child != null && child !== false);
}

/**
 * One line of text, cut where the row ends; pointing at a cut line shows all
 * of it. The child is the line itself, and it or a part of it does the
 * cutting (`truncate`).
 */
function Cut(props: { children: JSX.Element }) {
  // The line's whole text while some of it is cut off; undefined otherwise.
  const [whole, setWhole] = createSignal<string>();

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        as="span"
        class="flex min-w-0"
        onPointerEnter={(event: PointerEvent & { currentTarget: Element }) => {
          const line = event.currentTarget.firstElementChild;
          const cut =
            !!line &&
            [line, ...line.querySelectorAll('*')].some(
              (part) => part.scrollWidth > part.clientWidth
            );
          setWhole(cut ? (line.textContent ?? undefined) : undefined);
        }}
      >
        {props.children}
      </Tooltip.Trigger>
      {/* Measured as the pointer arrives, before the tooltip's delay ends. */}
      <Show when={whole()}>
        {(text) => (
          <Tooltip.Portal>
            <Tooltip.Content>
              <span class="block max-w-80 text-left">{text()}</span>
            </Tooltip.Content>
          </Tooltip.Portal>
        )}
      </Show>
    </Tooltip.Root>
  );
}

/**
 * The row's text as one press target: its title over one quiet line, each
 * kept to one line.
 */
function RowText(props: {
  titleId: string;
  title: string;
  /** A finished row's title is quieter, a dismissed one's quieter still. */
  tone?: 'done' | 'dismissed';
  onPress?: () => void;
  children: JSX.Element;
}) {
  const text = () => (
    <>
      <Cut>
        <Item.Title
          id={props.titleId}
          class={cn(
            'truncate font-medium',
            props.tone === 'done' && 'text-ink-muted',
            props.tone === 'dismissed' && 'text-ink-placeholder'
          )}
        >
          {props.title}
        </Item.Title>
      </Cut>
      {props.children}
    </>
  );

  return (
    <Show
      when={props.onPress}
      fallback={<div class="flex min-w-0 flex-col gap-0.5">{text()}</div>}
    >
      <button
        type="button"
        class="flex min-w-0 flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
        onClick={props.onPress}
      >
        {text()}
      </button>
    </Show>
  );
}

/** What went wrong with the row's last action, under its text. */
function RowNotes(props: { failed: boolean; changed: boolean }) {
  return (
    <>
      <Show when={props.failed}>
        <p role="alert" class="text-[13px] leading-[18px] text-failure">
          {t('suggestions.actionFailed')}
        </p>
      </Show>
      <Show when={props.changed}>
        <p
          role="status"
          class="text-[13px] leading-[18px] text-ink-muted"
          data-suggestion-changed
        >
          {t('suggestions.suggestionChanged')}
        </p>
      </Show>
    </>
  );
}

function DismissButton(props: RowState) {
  return (
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
      <CloseIcon class="size-3.5" />
    </Button>
  );
}

/**
 * The right side of a row that waits or runs. At rest it shows only how long
 * the row has waited. Pointing at the row or focusing in it shows its
 * buttons, and dismiss takes the time's place at the row's end. The buttons
 * keep their room while hidden, so nothing in the row moves.
 */
function RowEnd(props: RowState & { time: string; children: JSX.Element }) {
  return (
    <Item.Actions class="relative min-w-20 justify-end">
      <span class="flex items-center gap-1 opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
        {props.feedback}
        {props.children}
        <DismissButton {...props} />
      </span>
      <Item.Metadata
        class="pointer-events-none absolute right-0 whitespace-nowrap text-ink-placeholder transition-opacity group-focus-within/suggestion:opacity-0 not-touch:group-hover/suggestion:opacity-0"
        data-suggestion-time
      >
        {props.time}
      </Item.Metadata>
    </Item.Actions>
  );
}

/** What a background run will post or send; undefined when nothing. */
function sendsText(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'prompt' || suggestion.runMode !== 'background') {
    return undefined;
  }

  return suggestion.sends;
}

/** A row's second line: smaller and dimmer than its title, on one line. */
function RowLine(props: { class?: string; children: JSX.Element }) {
  return (
    <Cut>
      <Item.Description
        class={cn(
          'truncate text-[13px] leading-[18px] text-ink-extra-muted',
          props.class
        )}
      >
        {props.children}
      </Item.Description>
    </Cut>
  );
}

/** A routine's sentence as plain text; undefined once its routine is gone. */
function routineSentence(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'routine') return undefined;

  const text = suggestion.routine?.sentence.map((part) => part.text).join('');
  return text?.trim() ? text : undefined;
}

/** What pressing the row's button is called for its kind. */
function acceptLabel(props: MacroRowProps): string {
  const suggestion = props.suggestion;
  if (suggestion.kind === 'routine') return t('suggestions.turnOn');
  if (suggestion.kind === 'prompt' && suggestion.runMode === 'composer') {
    return t('suggestions.openInChat');
  }

  return props.status === 'failed'
    ? t('suggestions.runAgain')
    : t('suggestions.run');
}

/**
 * What looking without taking it up is called, where the row's button does
 * something else: a run's prompt opens in chat, a routine for review.
 */
function lookLabel(props: MacroRowProps): string | undefined {
  if (props.status === 'running') return undefined;

  const suggestion = props.suggestion;
  if (suggestion.kind === 'routine') return t('suggestions.review');
  if (suggestion.kind === 'prompt' && suggestion.runMode === 'background') {
    return t('suggestions.openInChat');
  }

  return undefined;
}

/** How long it has waited, or how long ago its run started. */
function macroTime(props: MacroRowProps): string {
  const suggestion = props.suggestion;
  if (
    props.status === 'running' &&
    suggestion.kind === 'prompt' &&
    suggestion.runMode === 'background' &&
    suggestion.run
  ) {
    return sinceLabel(suggestion.run.startedAt);
  }

  return ageLabel(suggestion);
}

/** The mark before the title: its kind, or how its run is going. */
function MacroLead(props: MacroRowProps) {
  return (
    <Switch fallback={<SparkleIcon class="text-violet-ink" />}>
      <Match when={props.status === 'running'}>
        <Spinner size="sm" decorative class="size-3.5" />
      </Match>
      <Match when={props.status === 'failed'}>
        <WarningCircleIcon class="text-failure" />
      </Match>
      <Match when={props.suggestion.kind === 'routine'}>
        <RepeatIcon class="text-orange" />
      </Match>
    </Switch>
  );
}

/**
 * The line under the title: what Macro will do, on one line. A run that
 * posts or sends something leads with that, so it is read before Run, which
 * is the approval.
 */
function MacroSentence(props: MacroRowProps) {
  const sends = () => sendsText(props.suggestion);
  // What follows what the run sends: how it stands, else what it will do.
  const rest = () => {
    if (props.status === 'failed') return t('suggestions.runFailed');
    if (props.status === 'running') return t('suggestions.runningNow');

    return routineSentence(props.suggestion) ?? props.suggestion.summary;
  };

  return (
    <RowLine class={props.status === 'failed' ? 'text-failure' : undefined}>
      <Show when={sends()} fallback={rest()}>
        {(line) => (
          <>
            <span data-suggestion-sends>{line()}</span>
            {' · '}
            {rest()}
          </>
        )}
      </Show>
    </RowLine>
  );
}

/**
 * Work Macro can do, as a row: its kind's mark, what it is, what Macro will
 * do, and one button that starts it. A run stays in its row while it runs
 * and when it fails.
 */
export function MacroRow(props: MacroRowProps) {
  const titleId = () => `suggestion-title-${props.suggestion.id}`;

  return (
    <Item
      size="sm"
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status={props.status}
      class="group/suggestion border-0 has-focus-visible:bg-hover not-touch:hover:bg-hover"
    >
      <Item.Icon class="[&>svg]:size-3.5" aria-hidden="true">
        <MacroLead {...props} />
      </Item.Icon>
      <Item.Content class="gap-0.5">
        <RowText
          titleId={titleId()}
          title={props.suggestion.title}
          onPress={props.onLook}
        >
          <MacroSentence {...props} />
        </RowText>
        <RowNotes failed={props.failed} changed={props.changed} />
      </Item.Content>
      <RowEnd {...props} time={macroTime(props)}>
        <Show when={lookLabel(props)}>
          {(label) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onLook}
              data-suggestion-look
            >
              {label()}
            </Button>
          )}
        </Show>
        <Show
          when={props.status !== 'running'}
          fallback={
            <Button variant="ghost" size="sm" onClick={props.onLook}>
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
            {acceptLabel(props)}
          </Button>
        </Show>
      </RowEnd>
    </Item>
  );
}

/**
 * Something waiting on the person, as a row: a circle that marks it done
 * (a plain mark on a reply, which is done once the person replies), what to
 * do, the item it is about, and how long it has waited. Pointing at
 * the row or focusing in it swaps the age for Open and dismiss.
 */
export function ToDoRow(props: ToDoRowProps) {
  const titleId = () => `suggestion-title-${props.suggestion.id}`;
  const drafted = () =>
    props.suggestion.kind === 'entity' && !!props.suggestion.draft;
  const summary = () => (
    <span class="truncate">{props.suggestion.summary}</span>
  );

  return (
    <Item
      size="sm"
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status={props.status}
      class="group/suggestion border-0 has-focus-visible:bg-hover not-touch:hover:bg-hover"
    >
      <Item.Icon>
        <Show
          when={props.onMarkDone}
          fallback={
            <Tooltip label={t('suggestions.doneOnReply')}>
              <span class="flex" data-suggestion-waits>
                <CircleIcon class="size-4 text-ink-placeholder" />
              </span>
            </Tooltip>
          }
        >
          {(markDone) => (
            <Button
              variant="ghost"
              size="icon-xs"
              class="-m-1"
              disabled={props.busy}
              aria-label={t('suggestions.markDoneSuggestion', {
                title: props.suggestion.title,
              })}
              tooltip={t('suggestions.markDone')}
              onClick={markDone()}
            >
              <CircleIcon class="size-4 text-ink-placeholder" />
            </Button>
          )}
        </Show>
      </Item.Icon>
      <Item.Content class="gap-0.5">
        <RowText
          titleId={titleId()}
          title={props.suggestion.title}
          onPress={props.onOpen}
        >
          <Cut>
            <Item.Description class="flex min-h-4.5 min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-[18px] text-ink-extra-muted">
              <Show when={props.suggestion.about[0]} fallback={summary()}>
                {(target) => (
                  <props.parts.Source
                    target={target()}
                    from={
                      props.suggestion.kind === 'entity'
                        ? props.suggestion.from
                        : undefined
                    }
                    fallback={summary()}
                  />
                )}
              </Show>
              <Show when={drafted()}>
                <span
                  class="-ml-1.5 shrink-0 whitespace-pre"
                  data-suggestion-drafted
                >
                  {` · ${t('suggestions.replyDrafted')}`}
                </span>
              </Show>
            </Item.Description>
          </Cut>
        </RowText>
        <RowNotes failed={props.failed} changed={props.changed} />
      </Item.Content>
      <RowEnd {...props} time={ageLabel(props.suggestion)}>
        <Button
          variant="secondary"
          size="sm"
          loading={props.busy}
          onClick={props.onOpen}
          data-suggestion-accept
        >
          {drafted() ? t('suggestions.openDraft') : t('suggestions.openItem')}
        </Button>
      </RowEnd>
    </Item>
  );
}

/**
 * A finished suggestion, as a quiet row: what it was, what was done, and
 * when. Pressing its text opens what it left.
 */
export function DoneRow(props: {
  suggestion: Suggestion;
  /** Rating the suggestion, shown when pointing at or focusing in the row. */
  feedback?: JSX.Element;
  onOpen(): void;
}) {
  const titleId = () => `suggestion-title-${props.suggestion.id}`;
  const line = () =>
    routineSentence(props.suggestion) ?? props.suggestion.summary;
  const feedback = children(() => props.feedback);
  // Without thumbs (feedback off or refused) the row is as it was.
  const hasFeedback = () => rendersSomething(feedback.toArray());

  return (
    <Item
      size="sm"
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status="done"
      class={cn(
        'border-0 has-focus-visible:bg-hover not-touch:hover:bg-hover',
        hasFeedback() && 'group/suggestion'
      )}
    >
      <Item.Icon class="text-success [&>svg]:size-3.5" aria-hidden="true">
        <CheckCircleIcon />
      </Item.Icon>
      <Item.Content class="gap-0.5">
        <RowText
          titleId={titleId()}
          title={props.suggestion.title}
          tone="done"
          onPress={props.onOpen}
        >
          <Show when={line()}>
            <RowLine class="text-ink-placeholder">{line()}</RowLine>
          </Show>
        </RowText>
      </Item.Content>
      <Show when={hasFeedback()}>
        <Item.Actions class="opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
          {feedback()}
        </Item.Actions>
      </Show>
      <Item.Metadata class="text-ink-placeholder" data-suggestion-time>
        {formatTime(props.suggestion.stateChangedAt)}
      </Item.Metadata>
    </Item>
  );
}

/** A dismissed suggestion, in its card until the person leaves, with Undo. */
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
  const titleId = () => `suggestion-title-${props.suggestion.id}`;

  return (
    <Item
      size="sm"
      class="border-0"
      data-suggestion-dismissed={props.suggestion.id}
    >
      <Item.Icon class="text-ink-disabled" aria-hidden="true">
        <CircleDashedIcon />
      </Item.Icon>
      <Item.Content class="gap-0.5">
        <RowText
          titleId={titleId()}
          title={props.suggestion.title}
          tone="dismissed"
        >
          <Item.Description class="text-[13px] leading-[18px] text-ink-placeholder">
            {t(
              props.wasRunning
                ? 'suggestions.dismissedAndStopped'
                : 'suggestions.dismissed'
            )}
          </Item.Description>
        </RowText>
        <Show when={props.failed}>
          <p role="alert" class="text-[13px] leading-[18px] text-failure">
            {t('suggestions.undoFailed')}
          </p>
        </Show>
      </Item.Content>
      <Button
        variant="ghost"
        size="sm"
        loading={props.busy}
        onClick={props.onUndo}
      >
        {t('suggestions.undo')}
      </Button>
    </Item>
  );
}
