import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import ClockClockwiseIcon from '@icon/system/regular/clock-clockwise.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, badgeTriggerClasses, cn } from '@ui';
import { format } from 'date-fns';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EventTriggerDraft,
  eventScopeKind,
  eventTriggerLabel,
  isGlobalEvent,
  newScheduleTrigger,
  type RoutineEventGroup,
  type RoutineTriggerDraft,
  routineEvents,
  type ScheduleTriggerDraft,
  validateTriggers,
} from '../core/routine-triggers';
import {
  parseRecurringSchedule,
  scheduleTriggerLabel,
} from '../core/schedule-language';
import { RoutineScheduleSettings } from './routine-schedule-settings';

type EventSlots = {
  renderEventLabel: (trigger: Accessor<EventTriggerDraft>) => JSX.Element;
  renderEventScope: (
    trigger: Accessor<EventTriggerDraft>,
    change: (ids: string[] | undefined) => void
  ) => JSX.Element;
  /** Absent where conditions are unavailable. */
  renderEventCondition?: (
    trigger: Accessor<EventTriggerDraft>,
    change: (condition: string | undefined) => void
  ) => JSX.Element;
};

/** Groups in the order people say them: time first, then what changed. */
const EVENT_GROUPS: RoutineEventGroup[] = [
  'Email',
  'Tasks',
  'Channels',
  'Documents',
  'Calls',
];

function scheduleSummary(trigger: ScheduleTriggerDraft) {
  const label = scheduleTriggerLabel(trigger);
  if (trigger.frequency === 'once') {
    const date = new Date(trigger.onceAt);
    return Number.isFinite(date.getTime())
      ? format(date, 'MMM d, h:mm a')
      : 'Run once';
  }
  if (trigger.frequency === 'hour' || trigger.frequency === 'custom')
    return label;
  const date = new Date(`2000-01-01T${trigger.time}`);
  return Number.isFinite(date.getTime())
    ? `${label}, ${format(date, 'h:mm a')}`
    : label;
}

function triggerGroup(trigger: EventTriggerDraft): RoutineEventGroup {
  return match(eventScopeKind(trigger))
    .returnType<RoutineEventGroup>()
    .with('TASK', () => 'Tasks')
    .with('THREAD', () => 'Email')
    .with('DOCUMENT', () => 'Documents')
    .with('CALL_RECORD', () => 'Calls')
    .with('CHANNEL', () => 'Channels')
    .exhaustive();
}

function EventIcon(props: { group: RoutineEventGroup; class: string }) {
  return (
    <Switch fallback={<FileIcon class={props.class} />}>
      <Match when={props.group === 'Channels'}>
        <HashIcon class={props.class} />
      </Match>
      <Match when={props.group === 'Tasks'}>
        <CheckCircleIcon class={props.class} />
      </Match>
      <Match when={props.group === 'Email'}>
        <EnvelopeIcon class={props.class} />
      </Match>
      <Match when={props.group === 'Calls'}>
        <PhoneIcon class={props.class} />
      </Match>
    </Switch>
  );
}

function TriggerIcon(props: { trigger: RoutineTriggerDraft; class: string }) {
  return (
    <Show
      when={props.trigger.kind === 'event' && props.trigger}
      fallback={
        <Show
          when={
            props.trigger.kind === 'schedule' &&
            props.trigger.frequency === 'once'
          }
          fallback={<ClockIcon class={props.class} />}
        >
          <CalendarIcon class={props.class} />
        </Show>
      }
    >
      {(event) => (
        <EventIcon group={triggerGroup(event())} class={props.class} />
      )}
    </Show>
  );
}

/** A row of a trigger menu: a highlighted, keyboard-reachable choice. */
function ChoiceRow(props: {
  onSelect: () => void;
  title?: string;
  children: JSX.Element;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      data-trigger-option
      title={props.title}
      class={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none hover:bg-ink/5 focus-visible:bg-ink/5 touch:min-h-11',
        props.selected && 'bg-ink/5'
      )}
      onClick={() => props.onSelect()}
    >
      {props.children}
    </button>
  );
}

function GroupLabel(props: { children: JSX.Element }) {
  return (
    <p class="flex h-7 items-end px-2 pb-1 text-xs text-ink-extra-muted">
      {props.children}
    </p>
  );
}

/** Add trigger: search, a typed schedule as the top row, then every trigger. */
function TriggerChoices(props: {
  onSelect: (trigger: RoutineTriggerDraft) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());
  const [search, setSearch] = createSignal('');
  const recurring = createMemo(() => {
    const parts = parseRecurringSchedule(search());
    return parts
      ? { ...newScheduleTrigger(parts.frequency), ...parts }
      : undefined;
  });
  // A typed schedule becomes the top row; the full list stays beneath it.
  const matches = (text: string) =>
    !!recurring() || text.toLowerCase().includes(search().trim().toLowerCase());
  const events = () =>
    routineEvents.filter((event) =>
      matches(`${event.group} ${event.label} ${event.description}`)
    );
  const showSchedule = () =>
    matches('On a schedule every hourly daily weekly monthly cron repeat');
  const showOnce = () => matches('Once one-off run once date');
  const nothing = () =>
    !recurring() && !events().length && !showSchedule() && !showOnce();
  return (
    <div
      class="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        // Keys that pick or confirm an IME candidate aren't the menu's.
        if (e.isComposing || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key))
          return;
        const items = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[data-trigger-option]'
          ),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement
        );
        if (e.key === 'Enter') {
          if (e.target instanceof HTMLInputElement) {
            e.preventDefault();
            items[0]?.click();
          }
          return;
        }
        e.preventDefault();
        items[
          (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }}
    >
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
        <SearchIcon class="size-4 shrink-0 text-ink-extra-muted" />
        <input
          ref={inputRef}
          aria-label="Search triggers"
          placeholder="Search, or type “every weekday at 9am”"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
        />
      </div>
      <div class="min-h-0 max-h-96 overflow-y-auto p-1.5">
        <Show when={recurring()}>
          {(parts) => (
            <>
              <ChoiceRow selected onSelect={() => props.onSelect(parts())}>
                <ClockClockwiseIcon class="size-4 shrink-0 self-start mt-0.5 text-ink-muted" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{scheduleSummary(parts())}</span>
                  <span class="truncate text-xs text-ink-muted">
                    {parts().timezone.replace(/_/g, ' ')}
                  </span>
                </span>
                <kbd class="shrink-0 rounded border border-edge-muted px-1 font-mono text-[11px] text-ink-extra-muted">
                  ↵
                </kbd>
              </ChoiceRow>
              <div class="mx-1 my-1 h-px bg-edge-muted" />
            </>
          )}
        </Show>
        <Show when={showSchedule() || showOnce()}>
          <GroupLabel>Time</GroupLabel>
          <Show when={showSchedule()}>
            <ChoiceRow
              onSelect={() => props.onSelect(newScheduleTrigger('day'))}
            >
              <ClockClockwiseIcon class="size-4 shrink-0 text-ink-muted" />
              On a schedule
            </ChoiceRow>
          </Show>
          <Show when={showOnce()}>
            <ChoiceRow
              onSelect={() => props.onSelect(newScheduleTrigger('once'))}
            >
              <CalendarIcon class="size-4 shrink-0 text-ink-muted" />
              Once
            </ChoiceRow>
          </Show>
        </Show>
        <For each={EVENT_GROUPS}>
          {(group) => (
            <Show when={events().some((event) => event.group === group)}>
              <GroupLabel>{group}</GroupLabel>
              <For each={events().filter((event) => event.group === group)}>
                {(event) => (
                  <ChoiceRow
                    title={event.description}
                    onSelect={() =>
                      props.onSelect({
                        id: crypto.randomUUID(),
                        kind: 'event',
                        events: [event.value],
                        ids: isGlobalEvent([event.value]) ? undefined : [],
                      })
                    }
                  >
                    {event.label}
                  </ChoiceRow>
                )}
              </For>
            </Show>
          )}
        </For>
        <Show when={nothing()}>
          <p class="px-2 py-3 text-sm text-ink-muted">No matching triggers</p>
        </Show>
      </div>
    </div>
  );
}

function scopeFieldLabel(trigger: EventTriggerDraft) {
  return match(eventScopeKind(trigger))
    .with('THREAD', () => 'Inbox')
    .with('TASK', () => 'Which tasks')
    .with('DOCUMENT', () => 'Which documents')
    .with('CHANNEL', () => 'Which channels')
    .with('CALL_RECORD', () => 'Which calls')
    .exhaustive();
}

/** What an event trigger watches: its scope as a token that opens a picker in place. */
function EventSettings(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onChange: (trigger: EventTriggerDraft) => void;
  }
) {
  const [choosing, setChoosing] = createSignal(false);
  const trigger = () => props.trigger;
  const hasScope = () =>
    !isGlobalEvent(props.trigger.events) || props.trigger.ids !== undefined;
  return (
    <div class="grid gap-3">
      <p class="text-xs leading-4 text-ink-muted">
        {props.trigger.events
          .map(
            (name) =>
              routineEvents.find((item) => item.value === name)?.description
          )
          .join(' ')}
      </p>
      <Show when={hasScope()}>
        <div class="grid gap-1.5">
          <span class="text-xs font-medium text-ink-muted">
            {scopeFieldLabel(props.trigger)}
          </span>
          <button
            type="button"
            aria-expanded={choosing()}
            class={badgeTriggerClasses({
              variant: 'secondary',
              size: 'sm',
              class: 'w-fit max-w-full',
            })}
            onClick={() => setChoosing(!choosing())}
          >
            <span class="min-w-0 truncate">
              {props.renderEventLabel(trigger)}
            </span>
            <CaretDownIcon
              class={cn(
                'size-3 shrink-0 transition-transform',
                choosing() && 'rotate-180'
              )}
            />
          </button>
          <Show when={choosing()}>
            <div class="max-h-60 overflow-y-auto rounded-lg border border-edge-muted">
              {props.renderEventScope(trigger, (ids) =>
                props.onChange({ ...props.trigger, ids })
              )}
            </div>
          </Show>
        </div>
      </Show>
      {props.renderEventCondition?.(trigger, (condition) =>
        props.onChange({ ...props.trigger, condition })
      )}
    </div>
  );
}

/**
 * One trigger's popover: choose a trigger (for a new one), then configure it.
 * `anchor` renders the element that opens it.
 */
function TriggerPopover(
  props: EventSlots & {
    trigger?: RoutineTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove?: () => void;
    anchorLabel: string;
    anchorTitle?: string;
    anchorClass: string;
    anchor: JSX.Element;
  }
) {
  let triggerRef: HTMLButtonElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal<RoutineTriggerDraft>();
  const [error, setError] = createSignal<string | null>(null);
  const edit = (trigger: RoutineTriggerDraft | undefined) => {
    setPending(trigger);
    setError(null);
  };
  const changeOpen = (value: boolean) => {
    if (value) edit(props.trigger);
    setOpen(value);
  };
  const schedule = () => {
    const value = pending();
    return value?.kind === 'schedule' ? value : undefined;
  };
  const event = () => {
    const value = pending();
    return value?.kind === 'event' ? value : undefined;
  };
  const title = () => {
    const value = event();
    if (value) return eventTriggerLabel(value);
    return schedule()?.frequency === 'once' ? 'Once' : 'On a schedule';
  };
  const save = () => {
    const value = pending();
    if (!value) return;
    const error = validateTriggers(
      [value],
      !props.trigger || value.kind === 'event'
    );
    if (error) {
      setError(error);
      return;
    }
    props.onSave(value);
    setOpen(false);
  };
  return (
    <Popover
      open={open()}
      onOpenChange={changeOpen}
      placement="bottom-start"
      gutter={6}
      boundary={() => document.documentElement}
    >
      <Popover.Trigger
        ref={triggerRef}
        aria-label={props.anchorLabel}
        title={props.anchorTitle}
        class={props.anchorClass}
      >
        {props.anchor}
      </Popover.Trigger>
      <Popover.Portal
        // Stay inside the dialog's focus boundary, outside the clipped composer panel.
        mount={triggerRef?.closest<HTMLElement>('[role="dialog"]') ?? undefined}
        ref={(element) => {
          element.style.display = 'contents';
        }}
      >
        <Popover.Content
          class="menu-surface z-modal flex max-h-[min(36rem,var(--kb-popper-content-available-height))] w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Popover.Title class="sr-only">
            {props.trigger ? 'Edit trigger' : 'Add trigger'}
          </Popover.Title>
          <Show when={pending()} fallback={<TriggerChoices onSelect={edit} />}>
            <div class="flex shrink-0 items-center gap-1.5 px-3.5 pt-3">
              <Show when={!props.trigger}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="-ml-1"
                  aria-label="Back to triggers"
                  onClick={() => edit(undefined)}
                >
                  <CaretLeftIcon class="size-3.5" />
                </Button>
              </Show>
              <span class="min-w-0 truncate text-sm font-semibold">
                {title()}
              </span>
            </div>
            <div class="min-h-0 overflow-y-auto overscroll-contain px-3.5 pb-3.5 pt-3">
              <Show when={schedule()}>
                {(value) => (
                  <RoutineScheduleSettings
                    trigger={value()}
                    onChange={(patch) => edit({ ...value(), ...patch })}
                  />
                )}
              </Show>
              <Show when={event()}>
                {(value) => (
                  <EventSettings
                    trigger={value()}
                    onChange={edit}
                    renderEventLabel={props.renderEventLabel}
                    renderEventScope={props.renderEventScope}
                    renderEventCondition={props.renderEventCondition}
                  />
                )}
              </Show>
              <Show when={error()}>
                {(message) => (
                  <p role="alert" class="mt-3 text-xs text-failure">
                    {message()}
                  </p>
                )}
              </Show>
            </div>
            <div class="flex shrink-0 items-center gap-1.5 border-t border-edge-muted px-3.5 py-2.5">
              <Show when={props.onRemove}>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    props.onRemove?.();
                  }}
                >
                  Remove trigger
                </Button>
              </Show>
              <span class="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={save}>
                {props.trigger ? 'Done' : 'Add trigger'}
              </Button>
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** A trigger token: the secondary badge every chosen value uses. */
function tokenClasses() {
  return badgeTriggerClasses({
    variant: 'secondary',
    size: 'sm',
    class: 'min-w-0 max-w-full text-left',
  });
}

/** A saved trigger as a token: its icon, name and what it watches. */
function TriggerToken(
  props: EventSlots & {
    trigger: RoutineTriggerDraft;
    /** Inline layouts fold the condition into the token. */
    withCondition?: boolean;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove: () => void;
  }
) {
  const event = () =>
    props.trigger.kind === 'event' ? props.trigger : undefined;
  const label = () =>
    props.trigger.kind === 'schedule'
      ? scheduleSummary(props.trigger)
      : eventTriggerLabel(props.trigger);
  return (
    <TriggerPopover
      {...props}
      anchorLabel={`Edit ${label()} trigger`}
      anchorTitle={
        props.trigger.kind === 'schedule'
          ? `${label()} · ${props.trigger.timezone.replace(/_/g, ' ')}`
          : [label(), event()?.condition?.trim()].filter(Boolean).join(' · if ')
      }
      anchorClass={tokenClasses()}
      anchor={
        <>
          <TriggerIcon trigger={props.trigger} class="size-3.5 shrink-0" />
          <span class="min-w-0 truncate">
            {label()}
            <Show when={event()}>
              {(value) => (
                <span class="text-ink-muted">
                  {' · '}
                  {props.renderEventLabel(value)}
                </span>
              )}
            </Show>
            <Show when={props.withCondition && event()?.condition?.trim()}>
              {(condition) => (
                <span class="text-ink-muted"> · if {condition()}</span>
              )}
            </Show>
          </span>
        </>
      }
    />
  );
}

function AddTrigger(
  props: EventSlots & {
    onAdd: (trigger: RoutineTriggerDraft) => void;
    label: string;
  }
) {
  return (
    <TriggerPopover
      {...props}
      onSave={props.onAdd}
      anchorLabel="Add trigger"
      anchorClass={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
      anchor={
        <>
          <PlusIcon class="size-3 shrink-0" />
          {props.label}
        </>
      }
    />
  );
}

/** A row of the When card: a short label, then its tokens. */
function TriggerRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <span class="w-16 shrink-0 text-xs text-ink-muted">{props.label}</span>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {props.children}
      </div>
    </div>
  );
}

export function RoutineTriggers(
  props: EventSlots & {
    triggers: RoutineTriggerDraft[];
    onChange: (triggers: RoutineTriggerDraft[]) => void;
    /**
     * `rows`: the routine page's When card, with each AI check on its own
     * "Only if" row. `inline` (default): tokens in a row, as in the composer.
     */
    layout?: 'rows' | 'inline';
  }
) {
  const ids = () => props.triggers.map((trigger) => trigger.id);
  const find = (id: string) =>
    props.triggers.find((trigger) => trigger.id === id);
  const replace = (id: string, value: RoutineTriggerDraft) =>
    props.onChange(
      props.triggers.map((trigger) => (trigger.id === id ? value : trigger))
    );
  const remove = (id: string) =>
    props.onChange(props.triggers.filter((trigger) => trigger.id !== id));
  const add = (trigger: RoutineTriggerDraft) =>
    props.onChange([...props.triggers, trigger]);
  const tokens = (withCondition: boolean) => (
    <For each={ids()}>
      {(id) => (
        <Show when={find(id)}>
          {(trigger) => (
            <TriggerToken
              trigger={trigger()}
              withCondition={withCondition}
              renderEventLabel={props.renderEventLabel}
              renderEventScope={props.renderEventScope}
              renderEventCondition={props.renderEventCondition}
              onSave={(value) => replace(id, value)}
              onRemove={() => remove(id)}
            />
          )}
        </Show>
      )}
    </For>
  );
  const addTrigger = (label: string) => (
    <AddTrigger
      label={label}
      renderEventLabel={props.renderEventLabel}
      renderEventScope={props.renderEventScope}
      renderEventCondition={props.renderEventCondition}
      onAdd={add}
    />
  );
  const conditioned = () =>
    props.triggers.flatMap((trigger) =>
      trigger.kind === 'event' && trigger.condition?.trim()
        ? [{ id: trigger.id, condition: trigger.condition.trim() }]
        : []
    );
  return (
    <Show
      when={props.layout === 'rows'}
      fallback={
        <>
          {tokens(true)}
          {addTrigger('Add trigger')}
        </>
      }
    >
      <div class="flex flex-col gap-2.5">
        <TriggerRow label="Trigger">
          {tokens(false)}
          {addTrigger(props.triggers.length ? 'Trigger' : 'Add trigger')}
        </TriggerRow>
        <For each={conditioned()}>
          {(item) => (
            <Show when={find(item.id)}>
              {(trigger) => (
                <TriggerRow label="Only if">
                  <TriggerPopover
                    trigger={trigger()}
                    renderEventLabel={props.renderEventLabel}
                    renderEventScope={props.renderEventScope}
                    renderEventCondition={props.renderEventCondition}
                    onSave={(value) => replace(item.id, value)}
                    onRemove={() => remove(item.id)}
                    anchorLabel={`Edit condition: ${item.condition}`}
                    anchorTitle={item.condition}
                    anchorClass={tokenClasses()}
                    anchor={
                      <>
                        <SparkleIcon class="size-3.5 shrink-0 text-accent" />
                        <span class="min-w-0 truncate">{item.condition}</span>
                      </>
                    }
                  />
                </TriggerRow>
              )}
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
