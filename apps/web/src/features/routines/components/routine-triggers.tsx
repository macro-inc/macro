import { Popover } from '@kobalte/core/popover';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckCircleIcon from '@phosphor/check-circle.svg';
import ClockIcon from '@phosphor/clock.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file-text.svg';
import HashIcon from '@phosphor/hash.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, badgeTriggerClasses } from '@ui';
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
import {
  type EventTriggerDraft,
  eventScopeKind,
  eventTriggerLabel,
  isGlobalEvent,
  newScheduleTrigger,
  type RoutineEventGroup,
  type RoutineTriggerDraft,
  routineEventGroups,
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
};

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
    </Switch>
  );
}

function TriggerIcon(props: { trigger?: RoutineTriggerDraft }) {
  const group = (): RoutineEventGroup => {
    if (props.trigger?.kind !== 'event') return 'Channels';
    const kind = eventScopeKind(props.trigger);
    if (kind === 'TASK') return 'Tasks';
    if (kind === 'THREAD') return 'Email';
    if (kind === 'DOCUMENT') return 'Documents';
    return 'Channels';
  };
  return (
    <Show
      when={props.trigger?.kind === 'event'}
      fallback={<ClockIcon class="size-3.5" />}
    >
      <EventIcon group={group()} class="size-3.5" />
    </Show>
  );
}

function TriggerChoices(props: {
  onSelect: (trigger: RoutineTriggerDraft) => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());
  const [search, setSearch] = createSignal('');
  const matches = (text: string) =>
    text.toLowerCase().includes(search().trim().toLowerCase());
  const recurring = createMemo(() => {
    const parts = parseRecurringSchedule(search());
    return parts
      ? { ...newScheduleTrigger(parts.frequency), ...parts }
      : undefined;
  });
  const events = () =>
    routineEvents.filter((event) =>
      matches(`${event.group} ${event.label} ${event.description}`)
    );
  return (
    <div
      class="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
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
      <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2.5">
        <SearchIcon class="size-4 shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          aria-label="Search triggers"
          placeholder="Search or type “every day at 9am”"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
        />
      </div>
      <div class="min-h-0 max-h-80 overflow-y-auto p-1.5">
        <Show when={recurring()}>
          {(parts) => (
            <button
              type="button"
              data-trigger-option
              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
              onClick={() => props.onSelect(parts())}
            >
              <ClockIcon class="size-4" />
              {scheduleSummary(parts())}
              <CaretRightIcon class="ml-auto size-3" />
            </button>
          )}
        </Show>
        <Show
          when={matches('Scheduled Hourly Daily Weekly Monthly Custom Cron')}
        >
          <button
            type="button"
            data-trigger-option
            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
            onClick={() => props.onSelect(newScheduleTrigger('day'))}
          >
            <ClockIcon class="size-4 text-ink-muted" /> Scheduled{' '}
            <CaretRightIcon class="ml-auto size-3 text-ink-muted" />
          </button>
        </Show>
        <Show when={matches('Run once one-off')}>
          <button
            type="button"
            data-trigger-option
            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
            onClick={() => props.onSelect(newScheduleTrigger('once'))}
          >
            <ClockIcon class="size-4 text-ink-muted" /> Run once{' '}
            <CaretRightIcon class="ml-auto size-3 text-ink-muted" />
          </button>
        </Show>
        <For each={routineEventGroups}>
          {(group) => (
            <Show when={events().some((event) => event.group === group)}>
              <p class="px-2 pb-1 pt-3 text-xs text-ink-extra-muted">{group}</p>
              <For each={events().filter((event) => event.group === group)}>
                {(event) => (
                  <button
                    type="button"
                    data-trigger-option
                    title={event.description}
                    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover focus-visible:bg-hover outline-none"
                    onClick={() =>
                      props.onSelect({
                        id: crypto.randomUUID(),
                        kind: 'event',
                        events: [event.value],
                        ids: isGlobalEvent([event.value]) ? undefined : [],
                      })
                    }
                  >
                    <EventIcon
                      group={group}
                      class="size-4 shrink-0 text-ink-muted"
                    />
                    {event.label}
                    <CaretRightIcon class="ml-auto size-3 text-ink-muted" />
                  </button>
                )}
              </For>
            </Show>
          )}
        </For>
        <Show
          when={
            !recurring() &&
            !events().length &&
            !matches('Scheduled Hourly Daily Weekly Monthly Custom Cron') &&
            !matches('Run once one-off')
          }
        >
          <p class="px-2 py-3 text-sm text-ink-muted">No matching triggers</p>
        </Show>
      </div>
    </div>
  );
}

/** One anchor and one panel for choosing and configuring a trigger. */
function TriggerChip(
  props: EventSlots & {
    trigger?: RoutineTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove?: () => void;
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
  const savedEvent = () => {
    const value = props.trigger;
    return value?.kind === 'event' ? value : undefined;
  };
  const label = () =>
    props.trigger?.kind === 'schedule'
      ? scheduleSummary(props.trigger)
      : props.trigger
        ? eventTriggerLabel(props.trigger)
        : 'Add trigger';
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
        aria-label={props.trigger ? `Edit ${label()} trigger` : 'Add trigger'}
        title={
          props.trigger?.kind === 'schedule'
            ? `${label()} · ${props.trigger.timezone.replace(/_/g, ' ')}`
            : label()
        }
        class={badgeTriggerClasses({
          variant: 'outline',
          size: 'sm',
          class: 'min-w-0 max-w-full text-left',
        })}
      >
        <Show when={props.trigger} fallback={<PlusIcon class="size-3" />}>
          <TriggerIcon trigger={props.trigger} />
        </Show>
        <span class="min-w-0 truncate">
          {label()}
          <Show when={savedEvent()}>
            {(value) => <> · {props.renderEventLabel(value)}</>}
          </Show>
        </span>
        <Show when={props.trigger}>
          <CaretDownIcon class="size-3" />
        </Show>
      </Popover.Trigger>
      <Popover.Portal
        // Stay inside the dialog's focus boundary, outside the clipped composer panel.
        mount={triggerRef?.closest<HTMLElement>('[role="dialog"]') ?? undefined}
        ref={(element) => {
          element.style.display = 'contents';
        }}
      >
        <Popover.Content
          class="z-modal flex max-h-[min(32rem,var(--kb-popper-content-available-height))] w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink shadow-lg"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Popover.Title class="sr-only">
            {props.trigger ? 'Edit trigger' : 'Add trigger'}
          </Popover.Title>
          <Show when={pending()} fallback={<TriggerChoices onSelect={edit} />}>
            <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
              <Show when={!props.trigger}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Back to triggers"
                  onClick={() => edit(undefined)}
                >
                  <ArrowLeftIcon class="size-4" />
                </Button>
              </Show>
              <span class="text-sm font-medium">
                {event()
                  ? eventTriggerLabel(event()!)
                  : schedule()?.frequency === 'once'
                    ? 'Run once'
                    : 'Scheduled'}
              </span>
            </div>
            <div class="min-h-0 overflow-y-auto overscroll-contain p-3">
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
                  <>
                    <p class="mb-3 text-xs text-ink-muted">
                      {value()
                        .events.map(
                          (name) =>
                            routineEvents.find((item) => item.value === name)
                              ?.description
                        )
                        .join(' ')}
                    </p>
                    {props.renderEventScope(value, (ids) =>
                      edit({ ...value(), ids })
                    )}
                  </>
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
            <div class="flex shrink-0 items-center justify-end gap-2 border-t border-edge-muted p-2">
              <Show when={props.onRemove}>
                <Button
                  variant="ghost"
                  size="sm"
                  class="mr-auto text-ink-muted"
                  onClick={() => {
                    setOpen(false);
                    props.onRemove?.();
                  }}
                >
                  Remove trigger
                </Button>
              </Show>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="strong" size="sm" onClick={save}>
                {props.trigger ? 'Done' : 'Add trigger'}
              </Button>
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

export function RoutineTriggers(
  props: EventSlots & {
    triggers: RoutineTriggerDraft[];
    onChange: (triggers: RoutineTriggerDraft[]) => void;
  }
) {
  return (
    <>
      <For each={props.triggers.map((trigger) => trigger.id)}>
        {(id) => (
          <TriggerChip
            trigger={props.triggers.find((trigger) => trigger.id === id)}
            renderEventLabel={props.renderEventLabel}
            renderEventScope={props.renderEventScope}
            onSave={(value) =>
              props.onChange(
                props.triggers.map((trigger) =>
                  trigger.id === id ? value : trigger
                )
              )
            }
            onRemove={() =>
              props.onChange(
                props.triggers.filter((trigger) => trigger.id !== id)
              )
            }
          />
        )}
      </For>
      <TriggerChip
        renderEventLabel={props.renderEventLabel}
        renderEventScope={props.renderEventScope}
        onSave={(trigger) => props.onChange([...props.triggers, trigger])}
      />
    </>
  );
}
