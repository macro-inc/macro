import { formatLocale, t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckIcon from '@icon/system/regular/check.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, cn, Item, Spinner, ToggleSwitch, Tooltip } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { SuggestionItemParts } from '../context/suggestions-source';
import { type FeedEntry, savedRoutineId } from '../core/lists';
import { doneWhenTakenUp, type Suggestion } from '../core/suggestion';
import { suggestionLook } from './suggestion-tile';
import { ageLabel } from './waiting';

export type SuggestionRowProps = {
  entry: FeedEntry;
  parts: SuggestionItemParts;
  /** Whether a turned-on row's saved routine is on; undefined while unknown. */
  routineEnabled?: boolean;
  /** Take it up: run it, open its chat or item, or turn its routine on. */
  onAccept(): void;
  /** Look at what Macro would do, or is doing, without taking it up. */
  onLook(): void;
  /** Open what a settled one left. */
  onOpen(): void;
  /** Take it up without opening anything: the person has dealt with it. */
  onMarkDone(): void;
  onUndoDone(): void;
  /** Stop its run and keep it. */
  onStop(): void;
  onDismiss(): void;
  onUndoDismiss(): void;
  onRoutineEnabled(enabled: boolean): void;
};

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

/** A row's second line: smaller and dimmer than its title, on one line. */
function RowLine(props: { class?: string; children: JSX.Element }) {
  return (
    <Cut>
      <Item.Description
        class={cn(
          'flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-ink-extra-muted',
          props.class
        )}
      >
        {props.children}
      </Item.Description>
    </Cut>
  );
}

/** A 32px tile: the kind's glyph on its colour, or how the row stands. */
function RowTile(props: { entry: FeedEntry }) {
  const look = () => suggestionLook(props.entry.suggestion);
  const neutral = 'bg-hover text-ink-muted';

  return (
    <Item.Media
      class={cn(
        'size-8 self-center rounded-lg',
        props.entry.state === 'failed' && 'bg-failure/15 text-failure',
        props.entry.state === 'finished' && 'bg-success/15 text-success',
        (props.entry.state === 'markedDone' ||
          props.entry.state === 'done' ||
          props.entry.state === 'dismissed') &&
          neutral,
        (props.entry.state === 'open' ||
          props.entry.state === 'running' ||
          props.entry.state === 'routineOn') &&
          look().fill
      )}
      aria-hidden="true"
      data-suggestion-tile
    >
      <Switch
        fallback={
          <Dynamic component={look().icon} class={cn('size-4', look().tint)} />
        }
      >
        <Match when={props.entry.state === 'running'}>
          <Spinner size="sm" decorative class={cn('size-4', look().tint)} />
        </Match>
        <Match when={props.entry.state === 'failed'}>
          <WarningCircleIcon class="size-4" />
        </Match>
        <Match
          when={
            props.entry.state === 'finished' ||
            props.entry.state === 'markedDone' ||
            props.entry.state === 'done'
          }
        >
          <CheckIcon class="size-4" />
        </Match>
        <Match when={props.entry.state === 'dismissed'}>
          <Dynamic component={look().icon} class="size-4 text-ink-disabled" />
        </Match>
      </Switch>
    </Item.Media>
  );
}

/** What a background run will post or send; undefined when nothing. */
function sendsText(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'prompt' || suggestion.runMode !== 'background') {
    return undefined;
  }

  return suggestion.sends;
}

/** The line a background run wrote saying what it did; undefined until then. */
function runReport(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'prompt' || suggestion.runMode !== 'background') {
    return undefined;
  }

  return suggestion.run?.report;
}

/** A routine's sentence as plain text; undefined once its routine is gone. */
function routineSentence(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'routine') return undefined;

  const text = suggestion.routine?.sentence.map((part) => part.text).join('');
  return text?.trim() ? text : undefined;
}

/** Asked to stop and not yet stopped. */
function stopping(suggestion: Suggestion): boolean {
  return (
    suggestion.kind === 'prompt' &&
    suggestion.runMode === 'background' &&
    !!suggestion.run?.stopping
  );
}

/**
 * What a run will post or send, then the rest: a run's line leads with it, so
 * it is read before Run, which is the approval.
 */
function SendsFirst(props: { suggestion: Suggestion; children: string }) {
  return (
    <Show when={sendsText(props.suggestion)} fallback={props.children}>
      {(sends) => (
        <span class="truncate">
          <span data-suggestion-sends>{sends()}</span>
          {` · ${props.children}`}
        </span>
      )}
    </Show>
  );
}

/** The item a to-do is about, who wrote, and whether a reply is drafted. */
function ItemLine(props: {
  suggestion: Suggestion;
  parts: SuggestionItemParts;
}) {
  const summary = () => (
    <span class="truncate">{props.suggestion.summary}</span>
  );
  const drafted = () =>
    props.suggestion.kind === 'entity' && !!props.suggestion.draft;

  return (
    <RowLine>
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
        <span class="-ml-1.5 shrink-0 whitespace-pre" data-suggestion-drafted>
          {` · ${t('suggestions.replyDrafted')}`}
        </span>
      </Show>
    </RowLine>
  );
}

/** The line under the title, for the row's state. */
function StateLine(props: SuggestionRowProps) {
  const suggestion = () => props.entry.suggestion;

  return (
    <Switch>
      <Match when={props.entry.state === 'dismissed' && props.entry.failed}>
        <RowLine class="text-failure">
          <span role="alert" class="truncate">
            {t('suggestions.undoFailed')}
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.failed}>
        <RowLine class="text-failure">
          {/* A run that sends keeps saying so: Run stays one press away. */}
          <span role="alert" class="truncate">
            <SendsFirst suggestion={suggestion()}>
              {t('suggestions.actionFailed')}
            </SendsFirst>
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.changed}>
        <RowLine class="text-ink-muted">
          <span role="status" class="truncate" data-suggestion-changed>
            <SendsFirst suggestion={suggestion()}>
              {t('suggestions.suggestionChanged')}
            </SendsFirst>
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'dismissed'}>
        <RowLine class="text-ink-placeholder">
          <span class="truncate">
            {t(
              suggestion().status === 'running'
                ? 'suggestions.dismissedAndStopped'
                : 'suggestions.dismissed'
            )}
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'markedDone'}>
        <RowLine>
          <span class="truncate">{t('suggestions.doneJustNow')}</span>
        </RowLine>
      </Match>
      <Match
        when={
          props.entry.state === 'routineOn' && props.routineEnabled === false
        }
      >
        <RowLine>
          <span class="size-1.5 shrink-0 rounded-full bg-ink-placeholder" />
          <span class="truncate">{t('suggestions.routineOffLine')}</span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'routineOn'}>
        <RowLine>
          <span class="size-1.5 shrink-0 rounded-full bg-success" />
          <span class="truncate">
            <Show
              when={routineWhen(suggestion())}
              fallback={t('suggestions.routineAdded')}
            >
              {(when) => t('suggestions.routineRuns', { when: when() })}
            </Show>
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'finished'}>
        <RowLine>
          <span class="truncate" data-suggestion-report>
            {runReport(suggestion()) ?? suggestion().summary}
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'done'}>
        <RowLine class="text-ink-placeholder">
          <span class="truncate">
            {runReport(suggestion()) ??
              routineSentence(suggestion()) ??
              suggestion().summary}
          </span>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'running'}>
        <RowLine>
          <SendsFirst suggestion={suggestion()}>
            {stopping(suggestion())
              ? t('suggestions.stoppingNow')
              : t('suggestions.runningNow')}
          </SendsFirst>
        </RowLine>
      </Match>
      <Match when={props.entry.state === 'failed'}>
        <RowLine class="text-failure">
          <SendsFirst suggestion={suggestion()}>
            {t('suggestions.runFailed')}
          </SendsFirst>
        </RowLine>
      </Match>
      <Match when={suggestion().kind === 'entity'}>
        <ItemLine suggestion={suggestion()} parts={props.parts} />
      </Match>
      <Match when={true}>
        <RowLine>
          <SendsFirst suggestion={suggestion()}>
            {routineSentence(suggestion()) ?? suggestion().summary}
          </SendsFirst>
        </RowLine>
      </Match>
    </Switch>
  );
}

/** When a routine suggestion's routine runs, e.g. "Fridays at 9:00 AM". */
function routineWhen(suggestion: Suggestion): string | undefined {
  return suggestion.kind === 'routine' ? suggestion.routine?.when : undefined;
}

/** What pressing an open or failed Macro row's button is called. */
function acceptLabel(entry: FeedEntry): string {
  const suggestion = entry.suggestion;
  if (suggestion.kind === 'routine') return t('suggestions.turnOn');
  if (suggestion.kind === 'prompt' && suggestion.runMode === 'composer') {
    return t('suggestions.openInChat');
  }
  if (suggestion.kind === 'entity') {
    return suggestion.draft
      ? t('suggestions.openDraft')
      : t('suggestions.openItem');
  }

  return entry.state === 'failed'
    ? t('suggestions.runAgain')
    : t('suggestions.run');
}

/** What pressing the row's text does, if anything. */
function pressAction(props: SuggestionRowProps): (() => void) | undefined {
  const entry = props.entry;
  if (entry.state === 'dismissed') return undefined;
  if (entry.state === 'open' && entry.suggestion.kind === 'entity') {
    return props.onAccept;
  }
  if (
    entry.state === 'open' ||
    entry.state === 'failed' ||
    entry.state === 'running'
  ) {
    return props.onLook;
  }

  return props.onOpen;
}

/**
 * The row's controls. `hover` shows only while the row is pointed at or
 * focused, in room it keeps while hidden so nothing moves. With a `time`,
 * the time stands where they are at rest; without one, `children` stay in
 * view after them.
 */
function RowEnd(props: {
  time?: string;
  hover?: JSX.Element;
  children?: JSX.Element;
}) {
  const reveal =
    'opacity-0 transition-opacity group-focus-within/suggestion:opacity-100 not-touch:group-hover/suggestion:opacity-100';

  return (
    <Item.Actions class="relative ml-2 justify-end gap-2">
      <Show
        when={props.time}
        fallback={
          <>
            <span
              class={cn('flex items-center gap-0.5', reveal)}
              data-suggestion-hover
            >
              {props.hover}
            </span>
            {props.children}
          </>
        }
      >
        {(time) => (
          <>
            <span
              class={cn('flex items-center gap-2', reveal)}
              data-suggestion-hover
            >
              <span class="flex items-center gap-0.5">{props.hover}</span>
              {props.children}
            </span>
            <span
              class="pointer-events-none absolute right-0 text-xs leading-4 font-medium whitespace-nowrap text-ink-placeholder transition-opacity group-focus-within/suggestion:opacity-0 not-touch:group-hover/suggestion:opacity-0"
              data-suggestion-time
            >
              {time()}
            </span>
          </>
        )}
      </Show>
    </Item.Actions>
  );
}

function MarkDoneButton(props: SuggestionRowProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={props.entry.busy}
      aria-label={t('suggestions.markDoneSuggestion', {
        title: props.entry.suggestion.title,
      })}
      tooltip={t('suggestions.markDone')}
      onClick={props.onMarkDone}
      data-suggestion-done
    >
      <CheckIcon class="size-4" />
    </Button>
  );
}

function DismissButton(props: SuggestionRowProps) {
  const running = () => props.entry.state === 'running';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t(
        running()
          ? 'suggestions.stopAndDismissSuggestion'
          : 'suggestions.dismissSuggestion',
        { title: props.entry.suggestion.title }
      )}
      tooltip={t(
        running() ? 'suggestions.stopAndDismiss' : 'suggestions.dismiss'
      )}
      onClick={props.onDismiss}
      data-suggestion-dismiss
    >
      <CloseIcon class="size-4" />
    </Button>
  );
}

/** Mark done and dismiss, for a row that waits on the person. */
function WaitingHover(props: SuggestionRowProps) {
  return (
    <>
      <Show when={doneWhenTakenUp(props.entry.suggestion)}>
        <MarkDoneButton {...props} />
      </Show>
      <DismissButton {...props} />
    </>
  );
}

/**
 * The control that replaces one the person just pressed (Mark done, Dismiss)
 * takes the focus it left behind, so the keyboard stays on the row.
 */
function takeLostFocus(element: HTMLElement) {
  onElementConnect(element, () => {
    const active = document.activeElement;
    if (!active || active === document.body) element.focus();
  });
}

/** A done row's time, in the interface language. */
function doneTime(at: string): string {
  return new Intl.DateTimeFormat(formatLocale(), { timeStyle: 'short' }).format(
    new Date(at)
  );
}

/** The right side of the row, for its state. */
function StateEnd(props: SuggestionRowProps) {
  const suggestion = () => props.entry.suggestion;
  const routineId = () => savedRoutineId(suggestion());

  return (
    <Switch>
      <Match when={props.entry.state === 'done'}>
        <RowEnd>
          <span
            class="text-xs leading-4 font-medium whitespace-nowrap text-ink-placeholder"
            data-suggestion-time
          >
            {doneTime(suggestion().stateChangedAt)}
          </span>
        </RowEnd>
      </Match>
      <Match when={props.entry.state === 'dismissed'}>
        <RowEnd>
          {/* A routine suggestion leaves with its idea, which the server can't bring back. */}
          <Show when={suggestion().kind !== 'routine'}>
            <Button
              ref={takeLostFocus}
              variant="ghost"
              size="sm"
              loading={props.entry.busy}
              onClick={props.onUndoDismiss}
              data-suggestion-undo
            >
              {t('suggestions.undo')}
            </Button>
          </Show>
        </RowEnd>
      </Match>
      <Match when={props.entry.state === 'markedDone'}>
        <RowEnd>
          <Show when={props.entry.canUndo}>
            <Button
              ref={takeLostFocus}
              variant="secondary"
              size="sm"
              loading={props.entry.busy}
              onClick={props.onUndoDone}
              data-suggestion-undo
            >
              {t('suggestions.undo')}
            </Button>
          </Show>
        </RowEnd>
      </Match>
      <Match when={props.entry.state === 'routineOn'}>
        <RowEnd>
          <Show when={routineId()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onOpen}
              data-suggestion-edit
            >
              {t('suggestions.editRoutine')}
            </Button>
            <ToggleSwitch
              checked={props.routineEnabled ?? true}
              onChange={props.onRoutineEnabled}
              label={t('suggestions.routineSwitch', {
                title: suggestion().title,
              })}
              labelClass="sr-only"
              data-suggestion-switch
            />
          </Show>
        </RowEnd>
      </Match>
      <Match when={props.entry.state === 'finished'}>
        <RowEnd>
          <Button
            variant="secondary"
            size="sm"
            loading={props.entry.busy}
            onClick={props.onOpen}
            data-suggestion-open
          >
            {t('suggestions.openItem')}
          </Button>
        </RowEnd>
      </Match>
      <Match when={props.entry.state === 'running'}>
        <RowEnd hover={<DismissButton {...props} />}>
          <Button
            variant="secondary"
            size="sm"
            loading={props.entry.busy || stopping(suggestion())}
            disabled={stopping(suggestion())}
            aria-label={t('suggestions.stopSuggestion', {
              title: suggestion().title,
            })}
            onClick={props.onStop}
            data-suggestion-stop
          >
            {t('suggestions.stop')}
          </Button>
        </RowEnd>
      </Match>
      <Match when={suggestion().kind === 'entity'}>
        <RowEnd
          time={ageLabel(suggestion())}
          hover={<WaitingHover {...props} />}
        >
          <Button
            variant="secondary"
            size="sm"
            loading={props.entry.busy}
            onClick={props.onAccept}
            data-suggestion-accept
          >
            {acceptLabel(props.entry)}
          </Button>
        </RowEnd>
      </Match>
      <Match when={true}>
        <RowEnd hover={<WaitingHover {...props} />}>
          <Button
            variant="secondary"
            size="sm"
            loading={props.entry.busy}
            onClick={props.onAccept}
            data-suggestion-accept
          >
            {acceptLabel(props.entry)}
          </Button>
        </RowEnd>
      </Match>
    </Switch>
  );
}

/**
 * One suggestion as a row, the same height in every state: a tile with its
 * kind's colour (or how it stands), its title over one quiet line, and its
 * controls. Pressing the text opens it, looks at it, or opens what it left.
 */
export function SuggestionRow(props: SuggestionRowProps) {
  const titleId = () => `suggestion-title-${props.entry.suggestion.id}`;
  const settled = () =>
    props.entry.state === 'markedDone' ||
    props.entry.state === 'done' ||
    props.entry.state === 'dismissed';
  const title = () => (
    <Cut>
      <Item.Title
        id={titleId()}
        class={cn(
          'truncate font-medium',
          props.entry.state === 'markedDone' && 'text-ink-muted line-through',
          props.entry.state === 'done' && 'text-ink-muted',
          props.entry.state === 'dismissed' && 'text-ink-placeholder'
        )}
      >
        {props.entry.state === 'routineOn'
          ? t(
              props.routineEnabled === false
                ? 'suggestions.routineIsOff'
                : 'suggestions.routineIsOn',
              { title: props.entry.suggestion.title }
            )
          : props.entry.suggestion.title}
      </Item.Title>
    </Cut>
  );

  return (
    <Item
      size="sm"
      role="article"
      aria-labelledby={titleId()}
      data-suggestion={props.entry.suggestion.id}
      data-suggestion-state={props.entry.state}
      data-suggestion-settled={settled() ? '' : undefined}
      class="group/suggestion h-14 border-0 px-4 py-2 has-focus-visible:bg-hover not-touch:hover:bg-hover"
    >
      <RowTile entry={props.entry} />
      <Item.Content class="gap-0.5">
        <Show
          when={pressAction(props)}
          fallback={<div class="flex min-w-0 flex-col gap-0.5">{title()}</div>}
        >
          {(press) => (
            <button
              type="button"
              class="flex min-w-0 flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
              onClick={() => press()()}
            >
              {title()}
            </button>
          )}
        </Show>
        <StateLine {...props} />
      </Item.Content>
      <StateEnd {...props} />
    </Item>
  );
}
