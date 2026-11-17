import { t } from '@app/lib/i18n';
import { formatTime } from '@core/util/date';
import SparkleIcon from '@icon/system/fill/sparkle-fill.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, cn, Hotkey, Item, Spinner, Tooltip } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import type { SuggestionItemParts } from '../context/suggestions-source';
import type { Suggestion, SuggestionStatus } from '../core/suggestion';
import { ageLabel } from './waiting';

type RowState = {
  suggestion: Suggestion;
  status: SuggestionStatus;
  /** Its action is under way. */
  busy: boolean;
  /** Its last action failed. */
  failed: boolean;
  /** It was rewritten since the row showed it; the action took nothing up. */
  changed: boolean;
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
  /** Take it up without opening anything: the person has dealt with it. */
  onMarkDone(): void;
};

/** The row's text as one press target: its title over one quiet line. */
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
      <Item.Title
        id={props.titleId}
        class={cn(
          'font-medium',
          props.tone === 'done' && 'text-ink-muted',
          props.tone === 'dismissed' && 'text-ink-placeholder'
        )}
      >
        {props.title}
      </Item.Title>
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

/** What a background run will post or send; undefined when nothing. */
function sendsText(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'prompt' || suggestion.runMode !== 'background') {
    return undefined;
  }

  return suggestion.sends;
}

/**
 * One line of a row that is cut where the row ends; pointing at a cut line
 * shows all of it.
 */
function RowLine(props: {
  /** The whole line, for when it is cut. */
  text: string;
  class?: string;
  children: JSX.Element;
}) {
  const [cut, setCut] = createSignal(false);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger as="span" class="flex min-w-0">
        <Item.Description
          class={cn(
            'truncate text-[13px] leading-[18px] text-ink-extra-muted',
            props.class
          )}
          onPointerEnter={(event) =>
            setCut(
              event.currentTarget.scrollWidth > event.currentTarget.clientWidth
            )
          }
        >
          {props.children}
        </Item.Description>
      </Tooltip.Trigger>
      {/* Measured as the pointer arrives, before the tooltip's delay ends. */}
      <Show when={cut()}>
        <Tooltip.Portal>
          <Tooltip.Content>
            <span class="block max-w-80 text-left">{props.text}</span>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Show>
    </Tooltip.Root>
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
  const text = () => {
    if (props.status === 'failed') return t('suggestions.runFailed');
    if (props.status === 'running') {
      return [t('suggestions.runningNow'), sends()].filter(Boolean).join(' ');
    }

    const body = routineSentence(props.suggestion) ?? props.suggestion.summary;
    return [sends(), body].filter(Boolean).join(' · ');
  };

  return (
    <RowLine
      text={text()}
      class={props.status === 'failed' ? 'text-failure' : undefined}
    >
      <Show when={props.status === 'open' && sends()} fallback={text()}>
        {(line) => (
          <>
            <span data-suggestion-sends>{line()}</span>
            {' · '}
            {props.suggestion.summary}
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
      <Item.Actions>
        <span class="opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
          <DismissButton {...props} />
        </span>
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
      </Item.Actions>
    </Item>
  );
}

/**
 * Something waiting on the person, as a row: a circle that marks it done,
 * what to do, the item it is about, and how long it has waited. Pointing at
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
        <Button
          variant="ghost"
          size="icon-xs"
          class="-m-1"
          disabled={props.busy}
          aria-label={t('suggestions.markDoneSuggestion', {
            title: props.suggestion.title,
          })}
          tooltip={t('suggestions.markDone')}
          onClick={props.onMarkDone}
        >
          <CircleIcon class="size-4 text-ink-placeholder" />
        </Button>
      </Item.Icon>
      <Item.Content class="gap-0.5">
        <RowText
          titleId={titleId()}
          title={props.suggestion.title}
          onPress={props.onOpen}
        >
          <Item.Description class="flex min-h-4.5 min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink-extra-muted">
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
        </RowText>
        <RowNotes failed={props.failed} changed={props.changed} />
      </Item.Content>
      <div class="relative flex h-7 min-w-36 shrink-0 items-center justify-end">
        <Item.Metadata
          class="text-ink-placeholder transition-opacity group-focus-within/suggestion:opacity-0 not-touch:group-hover/suggestion:opacity-0"
          data-suggestion-time
        >
          {ageLabel(props.suggestion)}
        </Item.Metadata>
        <div class="absolute right-0 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100">
          <Button
            variant="secondary"
            size="sm"
            loading={props.busy}
            onClick={props.onOpen}
            data-suggestion-accept
          >
            {drafted() ? t('suggestions.openDraft') : t('suggestions.openItem')}
            {/* Enter opens the row only while the keyboard is in it. */}
            <Hotkey
              shortcut="enter"
              aria-hidden="true"
              class="-mr-1.5 hidden size-4.5 justify-center rounded-[5px] bg-ink/10 text-xs text-ink-muted group-focus-within/suggestion:inline-flex"
            />
          </Button>
          <DismissButton {...props} />
        </div>
      </div>
    </Item>
  );
}

/**
 * A finished suggestion, as a quiet row: what it was, what was done, and
 * when. Pressing its text opens what it left.
 */
export function DoneRow(props: { suggestion: Suggestion; onOpen(): void }) {
  const titleId = () => `suggestion-title-${props.suggestion.id}`;
  const line = () =>
    routineSentence(props.suggestion) ?? props.suggestion.summary;

  return (
    <Item
      size="sm"
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.suggestion.id}
      data-suggestion-status="done"
      class="border-0 has-focus-visible:bg-hover not-touch:hover:bg-hover"
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
            <RowLine text={line()} class="text-ink-placeholder">
              {line()}
            </RowLine>
          </Show>
        </RowText>
      </Item.Content>
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
