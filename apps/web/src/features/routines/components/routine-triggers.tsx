import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
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
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  describeTrigger,
  type EventTriggerDraft,
  eventScopeKind,
  eventTriggerDescription,
  eventTriggerLabel,
  isGlobalEvent,
  type PayloadTestDraft,
  type RoutineEventGroup,
  type RoutineTriggerDraft,
  routineEvents,
  validateTriggers,
} from '../core/routine-triggers';
import { RoutineScheduleSettings } from './routine-schedule-settings';
import { menuMount } from './routine-search-menu';
import { TRIGGER_GROUP_ICONS } from './routine-trigger-icons';
import { TriggerMenu } from './routine-trigger-menu';

type EventSlots = {
  renderEventLabel: (trigger: Accessor<EventTriggerDraft>) => JSX.Element;
  renderEventScope: (
    trigger: Accessor<EventTriggerDraft>,
    change: (ids: string[] | undefined) => void
  ) => JSX.Element;
  /** Picks among the owner's inboxes; absent where inboxes can't be picked. */
  renderInboxPicker?: (
    inboxes: Accessor<string[]>,
    change: (inboxes: string[]) => void
  ) => JSX.Element;
  /** Names picked inboxes: "team@example.com", "2 inboxes". */
  renderInboxesLabel?: (inboxes: string[]) => JSX.Element;
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
  /** Wraps a group's choices, e.g. to ask for an account they need first. */
  renderEventGroup?: (
    group: RoutineEventGroup,
    options: () => JSX.Element
  ) => JSX.Element;
  /** False hides event triggers from the menu; existing ones stay editable. */
  offerEvents?: boolean;
};

function triggerGroup(trigger: EventTriggerDraft): RoutineEventGroup {
  return match(eventScopeKind(trigger))
    .returnType<RoutineEventGroup>()
    .with('TASK', () => 'Tasks')
    .with('THREAD', () => 'Email')
    .with('DOCUMENT', () => 'Documents')
    .with('CALL_RECORD', () => 'Calls')
    .with('CHANNEL', () => 'Channels')
    .with('GITHUB', () => 'GitHub')
    .exhaustive();
}

function TriggerIcon(props: { trigger: RoutineTriggerDraft; class: string }) {
  const icon = () =>
    props.trigger.kind === 'event'
      ? TRIGGER_GROUP_ICONS[triggerGroup(props.trigger)]
      : props.trigger.frequency === 'once'
        ? CalendarIcon
        : TRIGGER_GROUP_ICONS.Schedule;
  return <Dynamic component={icon()} class={props.class} />;
}

/** Whether an event trigger watches particular items, read as "in …". */
function hasScope(trigger: EventTriggerDraft) {
  return !isGlobalEvent(trigger.events) || trigger.ids !== undefined;
}

function scopeFieldLabel(trigger: EventTriggerDraft) {
  return match(eventScopeKind(trigger))
    .with('THREAD', () => 'Inbox')
    .with('TASK', () => 'Which tasks')
    .with('DOCUMENT', () => 'Which documents')
    .with('CHANNEL', () => 'Which channels')
    .with('CALL_RECORD', () => 'Which calls')
    .with('GITHUB', () => 'Repositories')
    .exhaustive();
}

/** A new event trigger's settings: what it watches, then its AI check. */
function EventSettings(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onChange: (trigger: EventTriggerDraft) => void;
  }
) {
  const [choosing, setChoosing] = createSignal(false);
  const trigger = () => props.trigger;
  return (
    <div class="grid gap-3">
      <p class="text-xs leading-4 text-ink-muted">
        {eventTriggerDescription(props.trigger)}
      </p>
      {props.renderEventSettings?.(trigger, (patch) =>
        props.onChange({ ...props.trigger, ...patch })
      )}
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
              renderEventSettings={props.renderEventSettings}
              renderEventGroup={props.renderEventGroup}
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
  const title = () => (props.isNew ? 'Add trigger' : 'Edit trigger');
  const body = () => (
    <PanelBody
      trigger={props.trigger}
      isNew={props.isNew}
      renderEventLabel={props.renderEventLabel}
      renderEventScope={props.renderEventScope}
      renderEventCondition={props.renderEventCondition}
      renderEventSettings={props.renderEventSettings}
      renderEventGroup={props.renderEventGroup}
      onSave={(value) => {
        props.onSave(value);
        props.onOpenChange(false);
      }}
      onClose={() => props.onOpenChange(false)}
      onRemove={props.onRemove}
      onBack={props.onBack}
    />
  );
  return (
    <Show
      when={isMobile()}
      fallback={
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
            // Inside a dialog (template activation), stay in its focus scope.
            mount={menuMount(anchor())}
            ref={(element) => {
              element.style.display = 'contents';
            }}
          >
            <Popover.Content
              class="menu-surface z-modal flex max-h-[min(36rem,var(--kb-popper-content-available-height))] w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Popover.Title class="sr-only">{title()}</Popover.Title>
              {body()}
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      }
    >
      {/* A phone edits the trigger in a sheet, not a panel by the token. */}
      <Show when={props.anchor}>
        {(value) => (
          <button
            ref={triggerRef}
            type="button"
            aria-label={value().label}
            aria-haspopup="dialog"
            aria-expanded={props.open}
            class={value().class}
            onClick={() => props.onOpenChange(true)}
          >
            {value().content}
          </button>
        )}
      </Show>
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={title()} class="flex flex-col">
            <MobileDrawer.Handle class="pb-1" />
            {body()}
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
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
        renderGroup={props.renderEventGroup}
        offerEvents={props.offerEvents}
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
            renderEventSettings={props.renderEventSettings}
            renderEventGroup={props.renderEventGroup}
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

/** Keep what still applies when an event trigger switches to another event. */
function switchEvent(
  current: EventTriggerDraft,
  next: EventTriggerDraft
): EventTriggerDraft {
  // Choosing the event it already has changes nothing.
  if (eventTriggerLabel(next) === eventTriggerLabel(current)) return current;
  const sameItems = eventScopeKind(current) === eventScopeKind(next);
  return {
    ...current,
    events: next.events,
    ids: sameItems ? current.ids : next.ids,
    inboxes: sameItems ? current.inboxes : undefined,
    ...switchGithub(current, next),
  };
}

const sameTest = (left: PayloadTestDraft, right: PayloadTestDraft) =>
  left.path === right.path &&
  left.op === right.op &&
  left.value === right.value;

/**
 * Moving between GitHub choices takes the new choice's events, actions and
 * payload tests, but keeps what the person narrowed it to: repositories, bots,
 * and the tests they added on top of the old choice.
 */
function switchGithub(
  current: EventTriggerDraft,
  next: EventTriggerDraft
): Pick<EventTriggerDraft, 'github' | 'match'> {
  if (!current.github || !next.github)
    return { github: next.github, match: next.match };
  const preset = routineEvents.find(
    (item) =>
      item.value === 'github' && item.label === eventTriggerLabel(current)
  )?.preset;
  const added = (current.match ?? []).filter(
    (test) => !preset?.match?.some((own) => sameTest(own, test))
  );
  const nextTests = next.match ?? [];
  const kept = added.filter(
    (test) => !nextTests.some((own) => own.path === test.path)
  );
  const match = [...nextTests, ...kept];
  return {
    github: {
      ...next.github,
      repositories: current.github.repositories,
      includeBots: current.github.includeBots,
    },
    // Set even when empty: the old choice's own tests must not carry over.
    match: match.length ? match : undefined,
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
        current={eventTriggerLabel(props.trigger)}
        renderGroup={props.renderEventGroup}
        offerEvents={props.offerEvents}
        onSelect={(value) => {
          if (value.kind !== 'event') {
            setSchedule({ ...value, id: props.trigger.id });
            return;
          }
          const next = switchEvent(props.trigger, value);
          if (next !== props.trigger) props.onSave(next);
        }}
        onRemove={props.onRemove}
        triggerLabel={`Change ${eventTriggerLabel(props.trigger)} trigger`}
        triggerTitle={eventTriggerLabel(props.trigger)}
        triggerVariant="secondary"
        triggerSize="md"
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
            renderEventSettings={props.renderEventSettings}
            renderEventGroup={props.renderEventGroup}
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
          size: 'md',
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

/** "in All repositories": a GitHub trigger's selector and payload tests, in its panel. */
function GithubToken(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onRemove: () => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  const trigger = () => props.trigger;
  return (
    <TriggerPanel
      {...props}
      open={open()}
      onOpenChange={setOpen}
      isNew={false}
      anchor={{
        label: `${scopeFieldLabel(props.trigger)} for ${eventTriggerLabel(props.trigger)}`,
        class: badgeTriggerClasses({
          variant: 'ghost',
          size: 'md',
          class: 'min-w-0 max-w-full',
        }),
        content: (
          <>
            <span class="min-w-0 truncate">
              {props.renderEventLabel(trigger)}
            </span>
            <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
          </>
        ),
      }}
    />
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

/** Edits the inboxes an email trigger watches: Cancel keeps them, Done saves them. */
function InboxBody(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
    onClose: () => void;
  }
) {
  const [inboxes, setInboxes] = createSignal(props.trigger.inboxes ?? []);
  return (
    <>
      <div class="px-3.5 pb-3.5 pt-3">
        {props.renderInboxPicker?.(inboxes, setInboxes)}
      </div>
      <div class="flex items-center justify-end gap-1.5 border-t border-edge-muted px-3.5 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            props.onSave({
              ...props.trigger,
              inboxes: inboxes().length ? inboxes() : undefined,
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

type FilterKind = 'inbox' | 'condition';

/** The filters a trigger can still take, in the order "+ Filter" offers them. */
function addableFilters(
  slots: EventSlots,
  trigger: EventTriggerDraft
): FilterKind[] {
  const kinds: FilterKind[] = [];
  if (
    slots.renderInboxPicker &&
    eventScopeKind(trigger) === 'THREAD' &&
    !trigger.inboxes?.length
  )
    kinds.push('inbox');
  if (slots.renderEventCondition && !trigger.condition?.trim())
    kinds.push('condition');
  return kinds;
}

/** A filter's menu surface, anchored to its row. */
function FilterPopover(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  row: (anchor: (element: HTMLDivElement) => void) => JSX.Element;
  children: JSX.Element;
}) {
  let anchor: HTMLDivElement | undefined;
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchorRef={() => anchor}
      placement="bottom-start"
      gutter={6}
    >
      <FilterRow>
        {props.row((element) => {
          anchor = element;
        })}
      </FilterRow>
      <Popover.Portal mount={menuMount(anchor)}>
        <Popover.Content class="menu-surface z-modal flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden">
          <Popover.Title class="sr-only">{props.title}</Popover.Title>
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** "Label | value | ×": a filter a trigger has, opened to edit it. */
function FilterChip(props: {
  icon: JSX.Element;
  label: string;
  value: JSX.Element;
  title: string;
  editLabel: string;
  open: boolean;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <ButtonGroup class="min-w-0 max-w-full">
      <Popover.Trigger
        as={ButtonGroup.Button}
        class="shrink-0 gap-1.5"
        aria-label={props.editLabel}
        title={props.title}
      >
        {props.icon}
        <span class="text-ink-muted">{props.label}</span>
      </Popover.Trigger>
      <ButtonGroup.Divider />
      <ButtonGroup.Button
        class="min-w-0 shrink"
        title={props.title}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        onClick={() => props.onOpen()}
      >
        <span class="min-w-0 truncate">{props.value}</span>
      </ButtonGroup.Button>
      <ButtonGroup.Divider />
      <ButtonGroup.Button
        size="icon-md"
        aria-label={props.removeLabel}
        onClick={() => props.onRemove()}
      >
        <XIcon class="size-3.5" />
      </ButtonGroup.Button>
    </ButtonGroup>
  );
}

/** "✦ Only if | question | ×": the trigger's AI check. */
function ConditionFilter(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    question: string;
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  return (
    <FilterPopover
      open={open()}
      onOpenChange={setOpen}
      title="Edit condition"
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <FilterChip
            icon={<SparkleIcon class="size-3.5 shrink-0 text-accent" />}
            label="Only if"
            value={props.question}
            title={props.question}
            editLabel={`Edit condition: ${props.question}`}
            open={open()}
            onOpen={() => setOpen(true)}
            onRemove={() =>
              props.onSave({ ...props.trigger, condition: undefined })
            }
            removeLabel="Remove condition"
          />
        </div>
      )}
    >
      <ConditionBody {...props} onClose={() => setOpen(false)} />
    </FilterPopover>
  );
}

/** "▭ Only | team@example.com | ×": the inboxes an email trigger watches. */
function InboxFilter(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    inboxes: string[];
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  return (
    <FilterPopover
      open={open()}
      onOpenChange={setOpen}
      title="Edit inboxes"
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <FilterChip
            icon={<TrayIcon class="size-3.5 shrink-0 text-ink-muted" />}
            label="Only"
            value={props.renderInboxesLabel?.(props.inboxes)}
            title="Inboxes this trigger watches"
            editLabel="Edit inboxes"
            open={open()}
            onOpen={() => setOpen(true)}
            onRemove={() =>
              props.onSave({ ...props.trigger, inboxes: undefined })
            }
            removeLabel="Watch every inbox"
          />
        </div>
      )}
    >
      <InboxBody {...props} onClose={() => setOpen(false)} />
    </FilterPopover>
  );
}

const FILTER_CHOICES: Record<
  FilterKind,
  {
    label: string;
    description: string;
    icon: Component<{ class?: string }>;
    iconClass: string;
  }
> = {
  inbox: {
    label: 'Inbox',
    description: 'Only mail into some of your inboxes',
    icon: TrayIcon,
    iconClass: 'text-ink-muted',
  },
  condition: {
    label: 'AI check',
    description: 'Only if it answers a yes/no question with yes',
    icon: SparkleIcon,
    iconClass: 'text-accent',
  },
};

/** "+ Filter": each filter the trigger can still take, or the only one. */
function AddFilter(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    kinds: FilterKind[];
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  const [picked, setPicked] = createSignal<FilterKind>();
  const kind = () => (props.kinds.length === 1 ? props.kinds[0] : picked());
  const close = () => {
    setOpen(false);
    setPicked(undefined);
  };
  return (
    <FilterPopover
      open={open()}
      onOpenChange={(value) => (value ? setOpen(true) : close())}
      title="Add filter"
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <Popover.Trigger
            as={Button}
            variant="ghost"
            size="sm"
            aria-label="Add filter"
          >
            <PlusIcon class="size-3.5 shrink-0" />
            Filter
          </Popover.Trigger>
        </div>
      )}
    >
      <Switch>
        <Match when={kind() === 'inbox'}>
          <InboxBody {...props} onClose={close} />
        </Match>
        <Match when={kind() === 'condition'}>
          <ConditionBody {...props} onClose={close} />
        </Match>
        <Match when={true}>
          <div class="flex flex-col p-1.5" role="menu">
            <For each={props.kinds}>
              {(choice) => (
                <button
                  type="button"
                  role="menuitem"
                  class="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover touch:min-h-11"
                  onClick={() => setPicked(choice)}
                >
                  <Dynamic
                    component={FILTER_CHOICES[choice].icon}
                    class={cn(
                      'size-4 shrink-0',
                      FILTER_CHOICES[choice].iconClass
                    )}
                  />
                  <span class="flex min-w-0 flex-col">
                    <span class="text-sm">{FILTER_CHOICES[choice].label}</span>
                    <span class="text-xs text-ink-muted">
                      {FILTER_CHOICES[choice].description}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </FilterPopover>
  );
}

/** A trigger's filters, each on its elbow, then "+ Filter" while more fit. */
function TriggerFilters(
  props: EventSlots & {
    trigger: EventTriggerDraft;
    onSave: (trigger: RoutineTriggerDraft) => void;
  }
) {
  const inboxes = () =>
    eventScopeKind(props.trigger) === 'THREAD' && props.trigger.inboxes?.length
      ? props.trigger.inboxes
      : undefined;
  const kinds = () => addableFilters(props, props.trigger);
  return (
    <div class="flex min-w-0 flex-col gap-2 pl-4.5">
      <Show when={inboxes()}>
        {(value) => <InboxFilter {...props} inboxes={value()} />}
      </Show>
      <Show when={props.trigger.condition?.trim()}>
        {(question) => <ConditionFilter {...props} question={question()} />}
      </Show>
      <Show when={kinds().length}>
        <AddFilter {...props} kinds={kinds()} />
      </Show>
    </div>
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
  /** An event trigger with a filter, or one that can take one. */
  const filtered = () => {
    const value = event();
    return value &&
      (value.condition?.trim() ||
        value.inboxes?.length ||
        addableFilters(props, value).length)
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
                  size: 'md',
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
                  <Switch>
                    {/* Email watches the owner's inboxes; an inbox filter narrows them. */}
                    <Match when={eventScopeKind(value()) === 'THREAD'}>
                      <span class="flex min-w-0 max-w-full items-center gap-2">
                        <span class="text-sm text-ink-muted">in</span>
                        <span class="truncate px-1 text-sm font-medium text-ink">
                          {props.renderEventLabel(value)}
                        </span>
                      </span>
                    </Match>
                    <Match when={eventScopeKind(value()) === 'GITHUB'}>
                      <span class="flex min-w-0 max-w-full items-center gap-2">
                        <span class="text-sm text-ink-muted">in</span>
                        <GithubToken {...props} trigger={value()} />
                      </span>
                    </Match>
                  </Switch>
                }
              >
                {/* "in" wraps with its scope, never alone at a line's end. */}
                <span class="flex min-w-0 max-w-full items-center gap-2">
                  <span class="text-sm text-ink-muted">in</span>
                  <ScopeToken {...props} trigger={value()} />
                </span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <Show when={filtered()}>
        {(value) => <TriggerFilters {...props} trigger={value()} />}
      </Show>
    </div>
  );
}

export function RoutineTriggers(
  props: EventSlots & {
    triggers: RoutineTriggerDraft[];
    onChange: (triggers: RoutineTriggerDraft[]) => void;
    /**
     * `rows` (default): the routine page's trigger card, each trigger a
     * sentence of tokens with its filters below. `add`: only the page's Add
     * trigger, for the tray under that card.
     */
    layout?: 'rows' | 'add';
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
    renderEventSettings: props.renderEventSettings,
    renderEventCondition: props.renderEventCondition,
    renderInboxPicker: props.renderInboxPicker,
    renderInboxesLabel: props.renderInboxesLabel,
    renderEventGroup: props.renderEventGroup,
    offerEvents: props.offerEvents,
  });
  return (
    <Switch>
      <Match when={props.layout === 'add'}>
        <AddTrigger
          {...slots()}
          label="Add trigger"
          variant="ghost"
          size="sm"
          onAdd={add}
        />
      </Match>
      <Match when={true}>
        <div class="flex min-w-0 flex-col gap-3.5">
          <For each={ids()}>
            {(id, index) => (
              <Show when={find(id)}>
                {(trigger) => (
                  <>
                    <Show when={index() > 0}>
                      <div class="flex items-center gap-2.5 text-xs text-ink-extra-muted">
                        <span class="h-px flex-1 bg-edge-divider" />
                        or
                        <span class="h-px flex-1 bg-edge-divider" />
                      </div>
                    </Show>
                    <TriggerSentence
                      {...slots()}
                      trigger={trigger()}
                      onSave={(value) => replace(id, value)}
                      onRemove={() => remove(id)}
                    />
                  </>
                )}
              </Show>
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}
