import { isModality } from '@core/mobile/inputModality';
import { isMobile } from '@core/mobile/isMobile';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { type ButtonSize, type ButtonVariant, Dropdown } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  untrack,
} from 'solid-js';
import {
  describeTrigger,
  isGlobalEvent,
  newScheduleTrigger,
  type RoutineEventGroup,
  type RoutineEventName,
  type RoutineTriggerDraft,
  routineEvents,
} from '../core/routine-triggers';
import { parseRecurringSchedule } from '../core/schedule-language';
import { menuMount } from './routine-search-menu';

type TriggerChoice = {
  key: string;
  label: string;
  description: string;
  /** The event it starts on; absent for schedules. */
  event?: RoutineEventName;
  make: () => RoutineTriggerDraft;
};

type TriggerType = {
  label: 'Schedule' | RoutineEventGroup;
  icon: Component<{ class?: string }>;
  choices: TriggerChoice[];
};

function eventChoices(group: RoutineEventGroup): TriggerChoice[] {
  return routineEvents
    .filter((event) => event.group === group)
    .map((event) => ({
      key: event.value,
      label: event.label,
      description: event.description,
      event: event.value,
      make: () => ({
        id: crypto.randomUUID(),
        kind: 'event',
        events: [event.value],
        ids: isGlobalEvent([event.value]) ? undefined : [],
      }),
    }));
}

/** One row per kind of trigger, time first, then the thing that changed. */
const TRIGGER_TYPES: TriggerType[] = [
  {
    label: 'Schedule',
    icon: ClockIcon,
    choices: [
      {
        key: 'schedule',
        label: 'On a schedule',
        description: 'Hourly, daily, weekly, monthly or on a cron.',
        make: () => newScheduleTrigger('day'),
      },
      {
        key: 'once',
        label: 'Once',
        description: 'One time, at a date and time.',
        make: () => newScheduleTrigger('once'),
      },
    ],
  },
  { label: 'Email', icon: EnvelopeIcon, choices: eventChoices('Email') },
  { label: 'Tasks', icon: CheckCircleIcon, choices: eventChoices('Tasks') },
  { label: 'Channels', icon: HashIcon, choices: eventChoices('Channels') },
  { label: 'Documents', icon: FileIcon, choices: eventChoices('Documents') },
  { label: 'Calls', icon: PhoneIcon, choices: eventChoices('Calls') },
];

/**
 * Rows act on pointerup, before the tap's compatibility mouse events, which
 * then land on whatever the row put under the finger: the page, once drilling
 * resized the menu and flipped it, or the closing menu, whose focus dismisses
 * the settings panel a choice just opened. Cancelling touchend drops them; the
 * tapped row has to stay in the document for its touchend to get here.
 */
function keepTapInMenu(event: TouchEvent) {
  event.preventDefault();
}

/** An event the trigger can start on: its name and what makes it fire. */
function ChoiceItem(props: {
  choice: TriggerChoice;
  current?: RoutineEventName;
  onSelect: (trigger: RoutineTriggerDraft) => void;
}) {
  const current = () =>
    !!props.choice.event && props.choice.event === props.current;
  return (
    <Dropdown.Item
      class="items-start touch:min-h-11"
      onTouchEnd={keepTapInMenu}
      onSelect={() => props.onSelect(props.choice.make())}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <Dropdown.ItemLabel class="truncate">
          {props.choice.label}
        </Dropdown.ItemLabel>
        <Dropdown.ItemDescription class="text-xs leading-4 text-ink-muted">
          {props.choice.description}
        </Dropdown.ItemDescription>
      </span>
      <Show when={current()}>
        <CheckIcon class="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
      </Show>
    </Dropdown.Item>
  );
}

/**
 * Choose a trigger: one row per type, each opening its events in a submenu.
 * Typing searches every submenu, and a typed schedule becomes the top row.
 * Phones have no submenus: a type opens in place, with a row back.
 */
export function TriggerMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (trigger: RoutineTriggerDraft) => void;
  /** The event a saved trigger starts on, checked in its submenu. */
  current?: RoutineEventName;
  /** For a saved trigger: offered at the bottom of the menu. */
  onRemove?: () => void;
  triggerLabel: string;
  triggerTitle?: string;
  triggerVariant: ButtonVariant;
  triggerSize: ButtonSize;
  triggerClass?: string;
  ref?: (element: HTMLButtonElement) => void;
  children: JSX.Element;
}) {
  let trigger: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;
  let content: HTMLElement | undefined;
  const [search, setSearch] = createSignal('');
  const [drilled, setDrilled] = createSignal<TriggerType>();
  /** On a phone: every type, or only the opened one above its events. */
  const shownTypes = () => {
    const type = drilled();
    return type ? [type] : TRIGGER_TYPES;
  };
  /**
   * Typing is how most people find a trigger, so the menu starts in its
   * search, but not on a phone, where the keyboard would cover the list.
   */
  const focusSearch = () => {
    if (!isModality('touch')) input?.focus();
  };
  const changeOpen = (open: boolean) => {
    if (open) {
      setSearch('');
      setDrilled(undefined);
    }
    props.onOpenChange(open);
  };
  const choose = (value: RoutineTriggerDraft) => {
    props.onSelect(value);
  };
  const query = () => search().trim().toLowerCase();
  const recurring = createMemo(() => {
    const parts = parseRecurringSchedule(search());
    return parts
      ? { ...newScheduleTrigger(parts.frequency), ...parts }
      : undefined;
  });
  const results = () =>
    TRIGGER_TYPES.flatMap((type) =>
      type.choices
        .filter((choice) =>
          `${type.label} ${choice.label} ${choice.description}`
            .toLowerCase()
            .includes(query())
        )
        .map((choice) => ({ type, choice }))
    );
  const firstItem = () =>
    content?.querySelector<HTMLElement>('[role^="menuitem"]') ?? undefined;
  /** What Enter in the search picks: a typed schedule, else the first match. */
  const topResult = () => recurring() ?? results()[0]?.choice.make();
  return (
    // Not modal: the settings panel opens as the menu closes, and a modal
    // menu would keep it hidden from assistive tech until its exit finishes.
    <Dropdown open={props.open} onOpenChange={changeOpen} modal={false}>
      <Dropdown.Trigger
        ref={(element: HTMLButtonElement) => {
          trigger = element;
          props.ref?.(element);
        }}
        variant={props.triggerVariant}
        size={props.triggerSize}
        class={props.triggerClass}
        aria-label={props.triggerLabel}
        title={props.triggerTitle}
        // The menu opens on pointerdown and focuses its search; the press's
        // mousedown would then move focus back here.
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        {props.children}
      </Dropdown.Trigger>
      <Dropdown.Content
        mount={menuMount(trigger)}
        class="w-60 max-w-[calc(100vw-1rem)]"
        ref={(element: HTMLElement) => {
          content = element;
        }}
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault();
          // Kobalte calls this inside its focus effect, so a signal read while
          // focusing would re-run that effect and send focus to the trigger.
          untrack(focusSearch);
          // The menu then focuses its list or first row a task later, from a
          // timer set before this one.
          setTimeout(() => {
            if (props.open) focusSearch();
          });
        }}
      >
        <div class="flex h-10 shrink-0 items-center gap-2 px-3">
          <SearchIcon class="size-4 shrink-0 text-ink-extra-muted" />
          <input
            ref={input}
            aria-label="Search triggers"
            placeholder="Search triggers"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Keys that pick or confirm an IME candidate aren't the menu's.
              if (event.isComposing) {
                event.stopPropagation();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                firstItem()?.focus();
              } else if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                const top = query() ? topResult() : undefined;
                if (top) {
                  props.onOpenChange(false);
                  choose(top);
                }
              } else if (event.key !== 'Escape' && event.key !== 'Tab') {
                // The menu's typeahead would move focus off the search.
                event.stopPropagation();
              }
            }}
            class="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
          />
        </div>
        <Show
          when={query()}
          fallback={
            <Show
              when={isMobile()}
              fallback={
                <Dropdown.Group>
                  <For each={TRIGGER_TYPES}>
                    {(type) => (
                      <Dropdown.Sub>
                        <Dropdown.SubTrigger>
                          <type.icon class="size-4 shrink-0 text-ink-muted" />
                          <span class="min-w-0 flex-1 truncate">
                            {type.label}
                          </span>
                          <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
                        </Dropdown.SubTrigger>
                        <Dropdown.SubContent
                          mount={menuMount(trigger)}
                          class="w-64 max-w-[calc(100vw-1rem)]"
                        >
                          <Dropdown.Group>
                            <Dropdown.GroupLabel>
                              {type.label}
                            </Dropdown.GroupLabel>
                            <For each={type.choices}>
                              {(choice) => (
                                <ChoiceItem
                                  choice={choice}
                                  current={props.current}
                                  onSelect={choose}
                                />
                              )}
                            </For>
                          </Dropdown.Group>
                        </Dropdown.SubContent>
                      </Dropdown.Sub>
                    )}
                  </For>
                </Dropdown.Group>
              }
            >
              <Dropdown.Group>
                {/* The opened type's row stays, as the row back. */}
                <For each={shownTypes()}>
                  {(type) => (
                    <>
                      <Dropdown.Item
                        closeOnSelect={false}
                        class="touch:min-h-11"
                        onTouchEnd={keepTapInMenu}
                        onSelect={() =>
                          setDrilled(drilled() ? undefined : type)
                        }
                      >
                        {/* Taps land on the row, which outlives the drill. */}
                        <span class="pointer-events-none contents">
                          <Show
                            when={drilled()}
                            fallback={
                              <>
                                <type.icon class="size-4 shrink-0 text-ink-muted" />
                                <span class="min-w-0 flex-1 truncate">
                                  {type.label}
                                </span>
                                <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
                              </>
                            }
                          >
                            <CaretLeftIcon class="size-3.5 shrink-0 text-ink-muted" />
                            <span class="font-medium">{type.label}</span>
                          </Show>
                        </span>
                      </Dropdown.Item>
                      <Show when={drilled()}>
                        <For each={type.choices}>
                          {(choice) => (
                            <ChoiceItem
                              choice={choice}
                              current={props.current}
                              onSelect={choose}
                            />
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
              </Dropdown.Group>
            </Show>
          }
        >
          <Dropdown.Group>
            <Show when={recurring()}>
              {(parts) => (
                <Dropdown.Item
                  class="items-start touch:min-h-11"
                  onTouchEnd={keepTapInMenu}
                  onSelect={() => choose(parts())}
                >
                  <ClockIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate">{describeTrigger(parts())}</span>
                    <span class="truncate text-xs text-ink-muted">
                      {parts().timezone.replace(/_/g, ' ')}
                    </span>
                  </span>
                  <kbd class="shrink-0 rounded border border-edge-muted px-1 font-mono text-[11px] text-ink-extra-muted">
                    ↵
                  </kbd>
                </Dropdown.Item>
              )}
            </Show>
            <For each={results()}>
              {(result) => (
                <Dropdown.Item
                  class="touch:min-h-11"
                  onTouchEnd={keepTapInMenu}
                  onSelect={() => choose(result.choice.make())}
                >
                  <Show
                    when={result.choice.key === 'once'}
                    fallback={
                      <result.type.icon class="size-4 shrink-0 text-ink-muted" />
                    }
                  >
                    <CalendarIcon class="size-4 shrink-0 text-ink-muted" />
                  </Show>
                  <span class="min-w-0 flex-1 truncate">
                    {result.choice.label}
                  </span>
                  <span class="shrink-0 text-xs text-ink-extra-muted">
                    {result.type.label}
                  </span>
                </Dropdown.Item>
              )}
            </For>
            <Show when={!recurring() && !results().length}>
              <p class="px-2 py-2 text-sm text-ink-muted">
                No matching triggers
              </p>
            </Show>
          </Dropdown.Group>
        </Show>
        <Show when={props.onRemove}>
          {(remove) => (
            <Dropdown.Group>
              <Dropdown.Item
                class="text-failure touch:min-h-11"
                onTouchEnd={keepTapInMenu}
                onSelect={() => remove()()}
              >
                Remove trigger
              </Dropdown.Item>
            </Dropdown.Group>
          )}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
