import GithubIcon from '@icon/mcp-github.svg';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import {
  Button,
  ButtonGroup,
  type ButtonSize,
  type ButtonVariant,
  badgeTriggerClasses,
  cn,
} from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  describeTrigger,
  type EventTriggerDraft,
  eventScopeKind,
  eventTriggerDescription,
  eventTriggerLabel,
  isGlobalEvent,
  type RoutineEventGroup,
  type RoutineTriggerDraft,
  routineEvents,
  validateTriggers,
} from '../core/routine-triggers';
import { RoutineScheduleSettings } from './routine-schedule-settings';
import { menuMount } from './routine-search-menu';
import { TriggerMenu } from './routine-trigger-menu';

type EventSlots = {
  renderEventLabel: (trigger: Accessor<EventTriggerDraft>) => JSX.Element;
  renderEventScope: (
    trigger: Accessor<EventTriggerDraft>,
    change: (ids: string[] | undefined) => void
  ) => JSX.Element;
  /** Settings particular to some events, such as GitHub's selector. */
  renderEventSettings?: (
    trigger: Accessor<EventTriggerDraft>,
    change: (patch: Partial<EventTriggerDraft>) => void
  ) => JSX.Element;
  /** Absent where conditions are unavailable. */
  renderEventCondition?: (
    trigger: Accessor<EventTriggerDraft>,
    change: (condition: string | undefined) => void
  ) => JSX.Element;
  /** Wraps a group's options, e.g. to ask for an account they need first. */
  renderEventGroup?: (
    group: RoutineEventGroup,
    options: () => JSX.Element
  ) => JSX.Element;
};

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

function TriggerIcon(props: { trigger: RoutineTriggerDraft; class: string }) {
  const group = () =>
    props.trigger.kind === 'event' ? triggerGroup(props.trigger) : undefined;
  return (
    <Switch fallback={<ClockIcon class={props.class} />}>
      <Match
        when={
          props.trigger.kind === 'schedule' &&
          props.trigger.frequency === 'once'
        }
      >
        <CalendarIcon class={props.class} />
      </Match>
      <Match when={group() === 'Channels'}>
        <HashIcon class={props.class} />
      </Match>
      <Match when={group() === 'Tasks'}>
        <CheckCircleIcon class={props.class} />
      </Match>
      <Match when={group() === 'Email'}>
        <EnvelopeIcon class={props.class} />
      </Match>
      <Match when={group() === 'Calls'}>
        <PhoneIcon class={props.class} />
      </Match>
      <Match when={props.group === 'GitHub'}>
        <GithubIcon class={props.class} />
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
    if (kind === 'CALL_RECORD') return 'Calls';
    if (kind === 'GITHUB') return 'GitHub';
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
  renderEventGroup?: EventSlots['renderEventGroup'];
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
    <div class="grid gap-3">
      <p class="text-xs leading-4 text-ink-muted">
        {props.trigger.events
          .map(
            (name) =>
              routineEvents.find((item) => item.value === name)?.description
          )
          .join(' ')}
      </p>
      <Show when={hasScope(props.trigger)}>
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
              {(props.renderEventGroup ?? ((_, options) => options()))(
                group,
                () => (
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
                            ...structuredClone(event.preset),
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
                )
              )}
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

/** The panel's contents, created fresh each time it opens. */
function PanelBody(
  props: EventSlots & {
    trigger: RoutineTriggerDraft;
    isNew: boolean;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onClose: () => void;
    onRemove?: () => void;
    onBack?: () => void;
  }
) {
  const [pending, setPending] = createSignal(props.trigger);
  const [error, setError] = createSignal<string | null>(null);
  const edit = (trigger: RoutineTriggerDraft) => {
    setPending(trigger);
    setError(null);
  };
  const schedule = () => {
    const value = pending();
    return value.kind === 'schedule' ? value : undefined;
  };
  const event = () => {
    const value = pending();
    return value.kind === 'event' ? value : undefined;
  };
  const title = () => {
    const value = event();
    if (value) return eventTriggerLabel(value);
    return schedule()?.frequency === 'once' ? 'Once' : 'On a schedule';
  };
  const save = () => {
    const value = pending();
    const message = validateTriggers(
      [value],
      props.isNew || value.kind === 'event'
    );
    if (message) {
      setError(message);
      return;
    }
    props.onSave(value);
  };
  return (
    <>
      <div class="flex shrink-0 items-center gap-1.5 px-3.5 pt-3">
        <Show when={props.onBack}>
          {(back) => (
            <Button
              variant="ghost"
              size="icon-xs"
              class="-ml-1"
              aria-label="Back to triggers"
              onClick={() => back()()}
            >
              <CaretLeftIcon class="size-3.5" />
            </Button>
          )}
        </Show>
        <span class="min-w-0 truncate text-sm font-semibold">{title()}</span>
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
          {(remove) => (
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={() => {
                props.onClose();
                remove()();
              }}
            >
              Remove trigger
            </Button>
          )}
        </Show>
        <span class="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save}>
          {props.isNew ? 'Add trigger' : 'Done'}
        </Button>
      </div>
    </>
  );
}

/**
 * One trigger's settings panel. With `anchor` it renders the element that
 * opens it; otherwise it opens beside `anchorRef`, e.g. after a menu choice.
 */
function TriggerPanel(
  props: EventSlots & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: RoutineTriggerDraft;
    isNew: boolean;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove?: () => void;
    onBack?: () => void;
    anchor?: {
      label: string;
      title?: string;
      class: string;
      content: JSX.Element;
    };
    anchorRef?: Accessor<HTMLElement | undefined>;
  }
) {
  let triggerRef: HTMLButtonElement | undefined;
  const anchor = () => props.anchorRef?.() ?? triggerRef;
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchorRef={props.anchorRef}
      placement="bottom-start"
      gutter={6}
      boundary={() => document.documentElement}
    >
      <Show when={props.anchor}>
        {(value) => (
          <Popover.Trigger
            ref={triggerRef}
            aria-label={value().label}
            title={value().title}
            class={value().class}
          >
            {value().content}
          </Popover.Trigger>
        )}
      </Show>
      <Popover.Portal
        // Stay inside the dialog's focus boundary, outside the clipped composer panel.
        mount={menuMount(anchor())}
        ref={(element) => {
          element.style.display = 'contents';
        }}
      >
        <Popover.Content
          class="menu-surface z-modal flex max-h-[min(36rem,var(--kb-popper-content-available-height))] w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Popover.Title class="sr-only">
            {props.isNew ? 'Add trigger' : 'Edit trigger'}
          </Popover.Title>
          <Show
            when={pending()}
            fallback={
              <TriggerChoices
                onSelect={edit}
                renderEventGroup={props.renderEventGroup}
              />
            }
          >
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
                      {eventTriggerDescription(value())}
                    </p>
                    {props.renderEventSettings?.(value, (patch) =>
                      edit({ ...value(), ...patch })
                    )}
                    {props.renderEventScope(value, (ids) =>
                      edit({ ...value(), ids })
                    )}
                    {props.renderEventCondition?.(value, (condition) =>
                      edit({ ...value(), condition })
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
              <Button variant="secondary" size="sm" onClick={save}>
                {props.trigger ? 'Done' : 'Add trigger'}
              </Button>
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** "+ Add trigger": the nested menu, then the chosen trigger's panel. */
function AddTrigger(
  props: EventSlots & {
    onAdd: (trigger: RoutineTriggerDraft) => void;
    label: string;
    variant: ButtonVariant;
    size: ButtonSize;
  }
) {
  let button: HTMLButtonElement | undefined;
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [pending, setPending] = createSignal<RoutineTriggerDraft>();
  return (
    <>
      <TriggerMenu
        open={menuOpen()}
        onOpenChange={setMenuOpen}
        onSelect={setPending}
        triggerLabel="Add trigger"
        triggerVariant={props.variant}
        triggerSize={props.size}
        ref={(element) => {
          button = element;
        }}
      >
        <PlusIcon class="size-3.5 shrink-0" />
        {props.label}
      </TriggerMenu>
      <Show when={pending()} keyed>
        {(trigger) => (
          <TriggerPanel
            open
            onOpenChange={(open) => {
              if (!open) setPending(undefined);
            }}
            trigger={trigger}
            isNew
            anchorRef={() => button}
            renderEventLabel={props.renderEventLabel}
            renderEventScope={props.renderEventScope}
            renderEventCondition={props.renderEventCondition}
            onSave={props.onAdd}
            onBack={() => {
              setPending(undefined);
              setMenuOpen(true);
            }}
          />
        )}
      </Show>
    </>
  );
}

/** A saved trigger as one token that opens its panel, as in the composer. */
function InlineToken(
  props: EventSlots & {
    trigger: RoutineTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove: () => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  const event = () =>
    props.trigger.kind === 'event' ? props.trigger : undefined;
  return (
    <TriggerPanel
      {...props}
      open={open()}
      onOpenChange={setOpen}
      isNew={false}
      anchor={{
        label: `Edit ${describeTrigger(props.trigger)} trigger`,
        title:
          props.trigger.kind === 'schedule'
            ? `${describeTrigger(props.trigger)} · ${props.trigger.timezone.replace(/_/g, ' ')}`
            : [describeTrigger(props.trigger), event()?.condition?.trim()]
                .filter(Boolean)
                .join(' · if '),
        class: badgeTriggerClasses({
          variant: 'secondary',
          size: 'sm',
          class: 'min-w-0 max-w-full text-left',
        }),
        content: (
          <>
            <TriggerIcon trigger={props.trigger} class="size-3.5 shrink-0" />
            <span class="min-w-0 truncate">
              {describeTrigger(props.trigger)}
              <Show when={event()}>
                {(value) => (
                  <span class="text-ink-muted">
                    {' · '}
                    {props.renderEventLabel(value)}
                  </span>
                )}
              </Show>
              <Show when={event()?.condition?.trim()}>
                {(condition) => (
                  <span class="text-ink-muted"> · if {condition()}</span>
                )}
              </Show>
            </span>
          </>
        ),
      }}
    />
  );
}

/** Keep what still applies when an event trigger switches to another event. */
function switchEvent(
  current: EventTriggerDraft,
  next: EventTriggerDraft
): EventTriggerDraft {
  const sameItems = eventScopeKind(current) === eventScopeKind(next);
  return {
    ...current,
    events: next.events,
    ids: sameItems ? current.ids : next.ids,
  };
}

/** The sentence's first token: the event, opening the menu to change it. */
function EventToken(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove: () => void;
  }
) {
  let button: HTMLButtonElement | undefined;
  const [menuOpen, setMenuOpen] = createSignal(false);
  // Switching to a schedule needs its settings first.
  const [schedule, setSchedule] = createSignal<RoutineTriggerDraft>();
  return (
    <>
      <TriggerMenu
        open={menuOpen()}
        onOpenChange={setMenuOpen}
        current={props.trigger.events[0]}
        onSelect={(value) =>
          value.kind === 'event'
            ? props.onSave(switchEvent(props.trigger, value))
            : setSchedule({ ...value, id: props.trigger.id })
        }
        onRemove={props.onRemove}
        triggerLabel={`Change ${eventTriggerLabel(props.trigger)} trigger`}
        triggerTitle={eventTriggerLabel(props.trigger)}
        triggerVariant="secondary"
        triggerSize="lg"
        triggerClass="min-w-0 max-w-full"
        ref={(element) => {
          button = element;
        }}
      >
        <TriggerIcon trigger={props.trigger} class="size-4 shrink-0" />
        <span class="min-w-0 truncate">{eventTriggerLabel(props.trigger)}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </TriggerMenu>
      <Show when={schedule()} keyed>
        {(value) => (
          <TriggerPanel
            open
            onOpenChange={(open) => {
              if (!open) setSchedule(undefined);
            }}
            trigger={value}
            isNew={false}
            anchorRef={() => button}
            renderEventLabel={props.renderEventLabel}
            renderEventScope={props.renderEventScope}
            renderEventCondition={props.renderEventCondition}
            onSave={props.onSave}
          />
        )}
      </Show>
    </>
  );
}

/** "in Your inbox": what the event watches, picked in place. */
function ScopeToken(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  let triggerRef: HTMLButtonElement | undefined;
  const trigger = () => props.trigger;
  return (
    <Popover placement="bottom-start" gutter={6}>
      <Popover.Trigger
        ref={triggerRef}
        aria-label={`${scopeFieldLabel(props.trigger)} for ${eventTriggerLabel(props.trigger)}`}
        class={badgeTriggerClasses({
          variant: 'ghost',
          size: 'lg',
          class: 'min-w-0 max-w-full',
        })}
      >
        <span class="min-w-0 truncate">{props.renderEventLabel(trigger)}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(triggerRef)}>
        <Popover.Content class="menu-surface z-modal max-h-80 w-80 max-w-[calc(100vw-1rem)] overflow-y-auto">
          <Popover.Title class="sr-only">
            {scopeFieldLabel(props.trigger)}
          </Popover.Title>
          {props.renderEventScope(trigger, (ids) =>
            props.onSave({ ...props.trigger, ids })
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** Edits a trigger's AI check: Cancel keeps it, Done saves it. */
function ConditionBody(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onClose: () => void;
  }
) {
  const [condition, setCondition] = createSignal(props.trigger.condition);
  return (
    <>
      <div class="px-3.5 pb-3.5 pt-3">
        {props.renderEventCondition?.(
          () => ({ ...props.trigger, condition: condition() }),
          setCondition
        )}
      </div>
      <div class="flex items-center justify-end gap-1.5 border-t border-edge-muted px-3.5 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const value = condition()?.trim();
            props.onSave({
              ...props.trigger,
              condition: value ? value : undefined,
            });
            props.onClose();
          }}
        >
          Done
        </Button>
      </div>
    </>
  );
}

/** A filter hanging off its trigger on a connector elbow. */
function FilterRow(props: { children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        class="-mt-4 h-4.5 w-3.5 shrink-0 rounded-bl-md border-b border-l border-edge"
      />
      {props.children}
    </div>
  );
}

/** "✦ Only if | question | ×", or "+ Filter" to add one. */
function ConditionFilter(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  let anchor: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const condition = () => props.trigger.condition?.trim();
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      anchorRef={() => anchor}
      placement="bottom-start"
      gutter={6}
    >
      <FilterRow>
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <Show
            when={condition()}
            fallback={
              <Popover.Trigger
                as={Button}
                variant="ghost"
                size="sm"
                aria-label="Add filter"
              >
                <PlusIcon class="size-3.5 shrink-0" />
                Filter
              </Popover.Trigger>
            }
          >
            {(question) => (
              <ButtonGroup class="min-w-0 max-w-full">
                <Popover.Trigger
                  as={ButtonGroup.Button}
                  class="shrink-0 gap-1.5 text-ink-muted"
                  aria-label={`Edit condition: ${question()}`}
                  title={question()}
                >
                  <SparkleIcon class="size-3.5 shrink-0 text-accent" />
                  Only if
                </Popover.Trigger>
                <ButtonGroup.Divider />
                <ButtonGroup.Button
                  class="min-w-0 shrink"
                  title={question()}
                  onClick={() => setOpen(true)}
                >
                  <span class="min-w-0 truncate">{question()}</span>
                </ButtonGroup.Button>
                <ButtonGroup.Divider />
                <ButtonGroup.Button
                  size="icon-md"
                  aria-label="Remove condition"
                  onClick={() =>
                    props.onSave({ ...props.trigger, condition: undefined })
                  }
                >
                  <XIcon class="size-3.5" />
                </ButtonGroup.Button>
              </ButtonGroup>
            )}
          </Show>
        </div>
      </FilterRow>
      <Popover.Portal mount={menuMount(anchor)}>
        <Popover.Content class="menu-surface z-modal flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden">
          <Popover.Title class="sr-only">
            {condition() ? 'Edit condition' : 'Add filter'}
          </Popover.Title>
          <ConditionBody
            trigger={props.trigger}
            renderEventLabel={props.renderEventLabel}
            renderEventScope={props.renderEventScope}
            renderEventCondition={props.renderEventCondition}
            onSave={props.onSave}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** One trigger as a sentence of tokens, its filters hanging below. */
function TriggerSentence(
  props: EventSlots & {
    trigger: RoutineTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove: () => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  const event = () =>
    props.trigger.kind === 'event' ? props.trigger : undefined;
  const schedule = () =>
    props.trigger.kind === 'schedule' ? props.trigger : undefined;
  /** An event trigger with a check, or one that can take a filter. */
  const filtered = () => {
    const value = event();
    return value && (value.condition?.trim() || props.renderEventCondition)
      ? value
      : undefined;
  };
  return (
    <div class="flex min-w-0 flex-col gap-2.5">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Show when={schedule()}>
          {(value) => (
            <TriggerPanel
              {...props}
              trigger={value()}
              open={open()}
              onOpenChange={setOpen}
              isNew={false}
              anchor={{
                label: `Edit ${describeTrigger(value())} trigger`,
                title: `${describeTrigger(value())} · ${value().timezone.replace(/_/g, ' ')}`,
                class: badgeTriggerClasses({
                  variant: 'secondary',
                  size: 'lg',
                  class: 'min-w-0 max-w-full',
                }),
                content: (
                  <>
                    <TriggerIcon trigger={value()} class="size-4 shrink-0" />
                    <span class="min-w-0 truncate">
                      {describeTrigger(value())}
                    </span>
                    <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                  </>
                ),
              }}
            />
          )}
        </Show>
        <Show when={event()}>
          {(value) => (
            <>
              <EventToken {...props} trigger={value()} />
              <Show
                when={hasScope(value())}
                fallback={
                  // Email always watches the owner's inbox: said, not picked.
                  <Show when={eventScopeKind(value()) === 'THREAD'}>
                    <span class="flex min-w-0 max-w-full items-center gap-2">
                      <span class="text-base text-ink-muted">in</span>
                      <span class="truncate px-1 text-base font-medium text-ink">
                        {props.renderEventLabel(value)}
                      </span>
                    </span>
                  </Show>
                }
              >
                {/* "in" wraps with its scope, never alone at a line's end. */}
                <span class="flex min-w-0 max-w-full items-center gap-2">
                  <span class="text-base text-ink-muted">in</span>
                  <ScopeToken {...props} trigger={value()} />
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <Show when={filtered()}>
        {(value) => (
          <div class="flex min-w-0 flex-col gap-2 pl-4.5">
            <ConditionFilter {...props} trigger={value()} />
          </div>
        )}
      </Show>
    </div>
  );
}

export function RoutineTriggers(
  props: EventSlots & {
    triggers: RoutineTriggerDraft[];
    onChange: (triggers: RoutineTriggerDraft[]) => void;
    /**
     * `rows`: the routine page's trigger card, each trigger a sentence of
     * tokens with its filters below. `inline` (default): tokens in a row,
     * as in the composer.
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
  const slots = () => ({
    renderEventLabel: props.renderEventLabel,
    renderEventScope: props.renderEventScope,
    renderEventCondition: props.renderEventCondition,
  });
  return (
    <>
      <For each={props.triggers.map((trigger) => trigger.id)}>
        {(id) => (
          <TriggerChip
            trigger={props.triggers.find((trigger) => trigger.id === id)}
            renderEventLabel={props.renderEventLabel}
            renderEventScope={props.renderEventScope}
            renderEventSettings={props.renderEventSettings}
            renderEventCondition={props.renderEventCondition}
            renderEventGroup={props.renderEventGroup}
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
        renderEventSettings={props.renderEventSettings}
        renderEventCondition={props.renderEventCondition}
        renderEventGroup={props.renderEventGroup}
        onSave={(trigger) => props.onChange([...props.triggers, trigger])}
      />
    </>
  );
}
