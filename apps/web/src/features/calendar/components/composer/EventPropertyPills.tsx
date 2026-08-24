import { UserIcon } from '@core/component/UserIcon';
import { emailToId, recipientEntityMapper } from '@core/user';
import { Combobox } from '@kobalte/core/combobox';
import { Popover } from '@kobalte/core/popover';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import CalendarDotsIcon from '@phosphor/calendar-dots.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import RepeatIcon from '@phosphor/repeat.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import { cn, Layer, Select, Tooltip } from '@ui';
import * as EmailValidator from 'email-validator';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Show,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import {
  formatReminderOffset,
  REMINDER_OVERRIDES_MAX,
  REMINDER_PRESET_MINUTES,
} from '../../utils/event-reminders';
import {
  type EventEditorCalendarOption,
  type EventEditorConferenceChoice,
  type EventEditorGuestOption,
  guestEmail,
  type SelectedEventEditorGuest,
} from './event-form-model';

const GUEST_NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: 'base',
});
const GUEST_OPTION_HEIGHT_PX = 36;
const GUEST_OPTION_MAX_VISIBLE_COUNT = 5;
const PROPERTY_TRIGGER_CLASS =
  'group flex h-7 items-center justify-between gap-1.5 rounded-full border border-edge-muted bg-surface px-2 py-1 text-left text-xs leading-tight text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-ink focus-visible:ring-accent/10 data-expanded:bg-hover data-expanded:text-ink';
const PROPERTY_VALUE_CLASS =
  'group-hover:text-ink group-focus-visible:text-ink group-data-expanded:text-ink';

export type EventComposerSelectOption = {
  value: string;
  label: string;
};

type GuestPickerItem =
  | { kind: 'guest'; guest: SelectedEventEditorGuest }
  | { kind: 'custom'; email: string };

function guestPickerItemEmail(item: GuestPickerItem) {
  return item.kind === 'guest' ? guestEmail(item.guest) : item.email;
}

function guestPickerItemValue(item: GuestPickerItem) {
  return guestPickerItemEmail(item).toLowerCase();
}

export interface EventComposerGuestsPillProps {
  options: Accessor<EventEditorGuestOption[]>;
  selected: SelectedEventEditorGuest[];
  onChange: (selected: SelectedEventEditorGuest[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  hideIcon?: boolean;
}

function guestDisplayName(guest: SelectedEventEditorGuest) {
  return ('name' in guest.data && guest.data.name) || guest.data.email;
}

function guestPropertyLabel(selected: SelectedEventEditorGuest[]) {
  if (selected.length === 0) return 'Guests';
  if (selected.length > 1) return `${selected.length} guests`;
  return guestDisplayName(selected[0]);
}

function ReadOnlyEventComposerGuestsPill(props: EventComposerGuestsPillProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Tooltip label="View event guests" placement="bottom">
        <Popover.Trigger
          disabled={props.disabled}
          aria-label="Guests"
          aria-readonly="true"
          class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
        >
          <Show when={!props.hideIcon}>
            <UsersIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          </Show>
          <span
            class={cn(
              'min-w-0 truncate',
              PROPERTY_VALUE_CLASS,
              props.selected.length > 0
                ? 'text-current'
                : 'text-ink-extra-muted'
            )}
          >
            {guestPropertyLabel(props.selected)}
          </span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-action-menu w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu p-1.5 text-sm shadow-menu menu-open-animation">
            <Popover.Title class="sr-only">Event guests</Popover.Title>
            <Show
              when={props.selected.length > 0}
              fallback={
                <p class="px-2 py-4 text-center text-sm text-ink-muted">
                  No guests
                </p>
              }
            >
              <div class="flex max-h-64 flex-col overflow-y-auto">
                <For each={props.selected}>
                  {(guest) => (
                    <div class="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-ink">
                      <UserIcon
                        id={guest.id}
                        size="sm"
                        isDeleted={false}
                        suppressClick
                      />
                      <div class="min-w-0 flex-1 truncate text-sm">
                        {guestDisplayName(guest)}
                        <Show
                          when={guestDisplayName(guest) !== guestEmail(guest)}
                        >
                          <span class="ml-[0.5em] text-ink-muted">
                            {guestEmail(guest)}
                          </span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}

function EditableEventComposerGuestsPill(props: EventComposerGuestsPillProps) {
  const inputId = `event-composer-guests-${createUniqueId()}`;

  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [comboboxDisabled, setComboboxDisabled] = createSignal(false);
  const [scrollToItem, setScrollToItem] = createSignal<(key: string) => void>();

  let input: HTMLInputElement | undefined;

  const propertyLabel = () => guestPropertyLabel(props.selected);

  const pickerOptions = createMemo(() => {
    const byEmail = new Map<string, SelectedEventEditorGuest>();
    for (const guest of props.options()) {
      byEmail.set(guestEmail(guest).toLowerCase(), guest);
    }
    for (const guest of props.selected) {
      byEmail.set(guestEmail(guest).toLowerCase(), guest);
    }
    return [...byEmail.values()].sort((left, right) =>
      GUEST_NAME_COLLATOR.compare(
        guestDisplayName(left),
        guestDisplayName(right)
      )
    );
  });

  const customEmail = () => {
    const email = search().trim();
    if (!EmailValidator.validate(email)) return undefined;
    if (
      pickerOptions().some(
        (guest) => guestEmail(guest).toLowerCase() === email.toLowerCase()
      )
    ) {
      return undefined;
    }
    return email;
  };

  const visibleItems = createMemo<GuestPickerItem[]>(() => {
    const items: GuestPickerItem[] = pickerOptions().map((guest) => ({
      kind: 'guest',
      guest,
    }));
    const email = customEmail();
    if (email) items.push({ kind: 'custom', email });
    return items;
  });

  const selectedItems = () =>
    props.selected.map((guest): GuestPickerItem => ({ kind: 'guest', guest }));

  const comboboxOptions = createMemo(() => {
    const items = new Map<string, GuestPickerItem>();
    for (const item of selectedItems()) {
      items.set(guestPickerItemValue(item), item);
    }
    for (const item of visibleItems()) {
      items.set(guestPickerItemValue(item), item);
    }
    return [...items.values()];
  });

  const isSelected = (guest: SelectedEventEditorGuest) =>
    props.selected.some(
      (selected) =>
        guestEmail(selected).toLowerCase() === guestEmail(guest).toLowerCase()
    );

  const changeSelection = (items: GuestPickerItem[]) => {
    const guests = new Map<string, SelectedEventEditorGuest>();
    for (const item of items) {
      const guest =
        item.kind === 'guest'
          ? item.guest
          : recipientEntityMapper('custom')({
              id: emailToId(item.email),
              email: item.email,
              invalid: false,
            });
      guests.set(guestEmail(guest).toLowerCase(), guest);
    }
    props.onChange([...guests.values()]);
    setSearch('');
    queueMicrotask(() => input?.focus());
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch('');
  };

  return (
    <Combobox<GuestPickerItem>
      multiple
      virtualized
      open={open() && !props.disabled}
      onOpenChange={changeOpen}
      onInputChange={setSearch}
      options={comboboxOptions()}
      value={selectedItems()}
      onChange={changeSelection}
      optionValue={guestPickerItemValue}
      optionLabel={(item) =>
        item.kind === 'guest' ? guestDisplayName(item.guest) : item.email
      }
      optionTextValue={(item) =>
        item.kind === 'guest'
          ? `${guestDisplayName(item.guest)} ${guestEmail(item.guest)}`
          : item.email
      }
      placeholder="Add guests..."
      closeOnSelection={false}
      allowsEmptyCollection
      placement="bottom-start"
      disabled={props.disabled || comboboxDisabled()}
    >
      <Combobox.Control<GuestPickerItem> class="inline-flex min-w-0 max-w-48 shrink-0">
        <Tooltip label="Add guests to this event" placement="bottom">
          <Combobox.Trigger
            tabIndex={0}
            aria-readonly={props.readOnly || undefined}
            class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              setOpen((current) => !current);
              queueMicrotask(() => input?.focus());
            }}
          >
            <Show when={!props.hideIcon}>
              <UsersIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            </Show>
            <span
              class={cn(
                'min-w-0 truncate',
                PROPERTY_VALUE_CLASS,
                props.selected.length > 0
                  ? 'text-current'
                  : 'text-ink-extra-muted'
              )}
            >
              {propertyLabel()}
            </span>
            <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
          </Combobox.Trigger>
        </Tooltip>
      </Combobox.Control>

      <Combobox.Portal>
        <Layer depth={3}>
          <Combobox.Content
            class="z-action-menu flex w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-edge bg-menu p-0 text-sm shadow-menu menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
          >
            <div class="flex w-full items-center gap-2 border-b border-edge-muted px-2 py-2">
              <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-muted" />
              <label for={inputId} class="sr-only">
                Search for guests
              </label>
              <Combobox.Input
                ref={input}
                id={inputId}
                class="w-full bg-transparent text-ink caret-accent outline-none placeholder:text-ink-placeholder"
                onKeyDown={(event) => {
                  if (
                    (event.key === 'a' && event.ctrlKey) ||
                    (event.key === 'a' && event.metaKey)
                  ) {
                    setComboboxDisabled(true);
                    queueMicrotask(() => setComboboxDisabled(false));
                  }
                }}
                on:keydown={(event: KeyboardEvent) => {
                  if (event.key === 'Escape' && open()) {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                  }
                }}
              />
            </div>

            <div class="p-1.5">
              <Combobox.Listbox<GuestPickerItem> scrollToItem={scrollToItem()}>
                {(items) => {
                  const nodes = Array.from(items());
                  const visibleCount = Math.min(
                    nodes.length,
                    GUEST_OPTION_MAX_VISIBLE_COUNT
                  );
                  const [virtualizer, setVirtualizer] =
                    createSignal<VirtualizerHandle | null>(null);

                  setScrollToItem(() => (key: string) => {
                    const index = nodes.findIndex((node) => node.key === key);
                    if (index >= 0) {
                      virtualizer()?.scrollToIndex(index, {
                        align: 'nearest',
                      });
                    }
                  });

                  return (
                    <Show
                      when={nodes.length > 0}
                      fallback={
                        <p class="py-4 text-center text-sm text-ink-muted">
                          No users found
                        </p>
                      }
                    >
                      <VList
                        data={nodes}
                        itemSize={GUEST_OPTION_HEIGHT_PX}
                        style={{
                          height: `${visibleCount * GUEST_OPTION_HEIGHT_PX}px`,
                        }}
                        ref={setVirtualizer}
                      >
                        {(node) => {
                          const item = node.rawValue;
                          return (
                            <Combobox.Item
                              item={node}
                              class="group flex h-9 w-full min-w-0 cursor-default items-center justify-between gap-1.5 rounded-lg px-2 text-left font-normal text-ink outline-none hover:bg-hover data-highlighted:bg-hover"
                            >
                              {item.kind === 'guest' ? (
                                <>
                                  <OptionCheckBox
                                    checked={isSelected(item.guest)}
                                    multiselect
                                  />
                                  <div class="flex min-w-0 flex-1 items-center gap-2">
                                    <div class="flex size-4 shrink-0 items-center">
                                      <UserIcon
                                        id={item.guest.id}
                                        size="sm"
                                        isDeleted={false}
                                        suppressClick
                                      />
                                    </div>
                                    <Combobox.ItemLabel class="min-w-0 max-w-full truncate">
                                      {guestDisplayName(item.guest)}
                                      <Show
                                        when={
                                          guestDisplayName(item.guest) !==
                                          guestEmail(item.guest)
                                        }
                                      >
                                        <span class="ml-[0.5em] opacity-50">
                                          {guestEmail(item.guest)}
                                        </span>
                                      </Show>
                                    </Combobox.ItemLabel>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div class="size-3.5 shrink-0" />
                                  <div class="flex size-4 shrink-0 items-center">
                                    <UserIcon
                                      id={item.email}
                                      size="sm"
                                      isDeleted={false}
                                      suppressClick
                                    />
                                  </div>
                                  <Combobox.ItemLabel class="truncate">
                                    Add {item.email}
                                  </Combobox.ItemLabel>
                                </>
                              )}
                            </Combobox.Item>
                          );
                        }}
                      </VList>
                    </Show>
                  );
                }}
              </Combobox.Listbox>
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}

/** Compact guest property pill with editable and read-only dropdown views. */
export function EventComposerGuestsPill(props: EventComposerGuestsPillProps) {
  return (
    <Show
      when={props.readOnly}
      fallback={<EditableEventComposerGuestsPill {...props} />}
    >
      <ReadOnlyEventComposerGuestsPill {...props} />
    </Show>
  );
}

export interface EventComposerLocationPillProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hideIcon?: boolean;
}

/** Compact editable location property pill. */
export function EventComposerLocationPill(
  props: EventComposerLocationPillProps
) {
  const [open, setOpen] = createSignal(false);
  let input: HTMLInputElement | undefined;

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={(nextOpen) => setOpen(!props.disabled && nextOpen)}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Tooltip label="Set the event location" placement="bottom">
        <Popover.Trigger
          disabled={props.disabled}
          aria-label="Location"
          class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
        >
          <Show when={!props.hideIcon}>
            <MapPinIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          </Show>
          <span
            class={cn(
              'min-w-0 truncate',
              PROPERTY_VALUE_CLASS,
              props.value ? 'text-current' : 'text-ink-extra-muted'
            )}
          >
            {props.value || 'Add location'}
          </span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="z-action-menu w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu p-2 shadow-menu menu-open-animation"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(() => input?.focus());
            }}
          >
            <Popover.Title class="sr-only">Event location</Popover.Title>
            <input
              ref={input}
              type="text"
              value={props.value}
              onInput={(event) => props.onChange(event.currentTarget.value)}
              placeholder="Add location..."
              aria-label="Location"
              disabled={props.disabled}
              class="h-8 w-full rounded-md border border-edge-muted bg-surface px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}

interface EventComposerConferenceOption {
  value: EventEditorConferenceChoice;
  label: string;
}

const GOOGLE_MEET_OPTION: EventComposerConferenceOption = {
  value: 'google_meet',
  label: 'Google Meet',
};
const NO_CONFERENCING_OPTION: EventComposerConferenceOption = {
  value: 'none',
  label: 'No meeting link',
};
const EXISTING_CONFERENCING_OPTION: EventComposerConferenceOption = {
  value: 'existing',
  label: 'Current conferencing',
};

export interface EventComposerConferencePillProps {
  value: EventEditorConferenceChoice;
  canKeepExisting: boolean;
  onChange: (value: EventEditorConferenceChoice) => void;
  disabled?: boolean;
}

/** Compact selector for adding, replacing, or removing video conferencing. */
export function EventComposerConferencePill(
  props: EventComposerConferencePillProps
) {
  const options = createMemo(() => [
    NO_CONFERENCING_OPTION,
    ...(props.canKeepExisting ? [EXISTING_CONFERENCING_OPTION] : []),
    GOOGLE_MEET_OPTION,
  ]);
  const selectedOption = () =>
    options().find((option) => option.value === props.value) ?? options()[0];

  return (
    <Select<EventComposerConferenceOption>
      options={options()}
      value={selectedOption()}
      onChange={(option) => option && props.onChange(option.value)}
      optionValue="value"
      optionTextValue="label"
      disabled={props.disabled}
    >
      <Tooltip label="Set event video conferencing" placement="bottom">
        <Select.Trigger
          aria-label="Video conferencing"
          class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
        >
          <VideoCameraIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          <Select.Value<EventComposerConferenceOption>>
            {(selectState) => (
              <span
                class={cn(
                  'truncate',
                  PROPERTY_VALUE_CLASS,
                  props.value === 'none' && 'text-ink-extra-muted'
                )}
              >
                {props.value === 'none'
                  ? 'Add meeting link'
                  : selectState.selectedOption().label}
              </span>
            )}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
      </Tooltip>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

export interface EventComposerRemindersPillProps {
  minutes: number[];
  usedSlots: number;
  canAdd: boolean;
  onChange: (minutes: number[]) => void;
  disabled?: boolean;
}

const REMINDER_PRESET_MINUTE_SET = new Set(REMINDER_PRESET_MINUTES);
const REMINDER_OPTION_CACHE = new Map<number, EventComposerSelectOption>();

function reminderOption(minutes: number): EventComposerSelectOption {
  const cached = REMINDER_OPTION_CACHE.get(minutes);
  if (cached) return cached;
  const option = {
    value: String(minutes),
    label: formatReminderOffset(minutes),
  };
  REMINDER_OPTION_CACHE.set(minutes, option);
  return option;
}

const REMINDER_PRESET_OPTIONS = REMINDER_PRESET_MINUTES.map(reminderOption);

function reminderOptions(customMinutesKey: string) {
  if (customMinutesKey === '') return REMINDER_PRESET_OPTIONS;
  return [
    ...REMINDER_PRESET_OPTIONS,
    ...customMinutesKey.split(',').map(Number).map(reminderOption),
  ].sort((first, second) => Number(first.value) - Number(second.value));
}

function reminderPropertyLabel(minutes: number[]) {
  if (minutes.length === 0) return 'Choose reminders';
  if (minutes.length === 1) return formatReminderOffset(minutes[0]);
  return `${minutes.length} notifications`;
}

/** Compact multi-select for event popup notification offsets. */
export function EventComposerRemindersPill(
  props: EventComposerRemindersPillProps
) {
  const customMinutesKey = createMemo(() =>
    props.minutes
      .filter((minutes) => !REMINDER_PRESET_MINUTE_SET.has(minutes))
      .sort((first, second) => first - second)
      .join(',')
  );
  const options = createMemo(() => reminderOptions(customMinutesKey()));
  const selectedOptions = createMemo(() => {
    const selected = new Set(props.minutes);
    return options().filter((option) => selected.has(Number(option.value)));
  });
  const changeSelection = (selected: EventComposerSelectOption[]) => {
    const next = selected
      .map((option) => Number(option.value))
      .sort((first, second) => first - second);
    const current = [...props.minutes].sort((first, second) => first - second);
    if (
      next.length === current.length &&
      next.every((minutes, index) => minutes === current[index])
    ) {
      return;
    }
    props.onChange(next);
  };

  return (
    <Select<EventComposerSelectOption>
      multiple
      options={options()}
      value={selectedOptions()}
      onChange={changeSelection}
      optionValue="value"
      optionTextValue="label"
      optionDisabled={(option) =>
        !props.minutes.includes(Number(option.value)) && !props.canAdd
      }
      closeOnSelection={false}
      selectionBehavior="toggle"
      placeholder="Choose reminders"
      disabled={props.disabled}
      itemComponent={(itemProps) => (
        <Select.Item item={itemProps.item}>
          <OptionCheckBox
            checked={props.minutes.includes(
              Number(itemProps.item.rawValue.value)
            )}
            multiselect
          />
          <Select.ItemLabel class="min-w-0 flex-1 truncate">
            {itemProps.item.rawValue.label}
          </Select.ItemLabel>
        </Select.Item>
      )}
    >
      <Tooltip label="Set event notifications" placement="bottom">
        <Select.Trigger
          aria-label="Notifications"
          class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
        >
          <BellSimpleIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          <Select.Value<EventComposerSelectOption>>
            {(selectState) => (
              <span class={cn('truncate', PROPERTY_VALUE_CLASS)}>
                {reminderPropertyLabel(
                  selectState
                    .selectedOptions()
                    .map((option) => Number(option.value))
                )}
              </span>
            )}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
      </Tooltip>
      <Select.Content class="w-56 p-0">
        <div class="flex items-center justify-between border-edge-muted border-b px-3 py-2 text-xs text-ink-muted">
          <span>Choose reminders</span>
          <span
            aria-label={`${props.usedSlots} of ${REMINDER_OVERRIDES_MAX} notifications selected`}
          >
            {props.usedSlots} / {REMINDER_OVERRIDES_MAX}
          </span>
        </div>
        <Select.Listbox class="p-1.5" />
      </Select.Content>
    </Select>
  );
}

export interface EventComposerRecurrencePillProps {
  options: EventComposerSelectOption[];
  value: EventComposerSelectOption;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  hideIcon?: boolean;
}

/** Compact recurrence property pill. */
export function EventComposerRecurrencePill(
  props: EventComposerRecurrencePillProps
) {
  return (
    <Select<EventComposerSelectOption>
      options={props.options}
      value={props.value}
      onChange={(option) => {
        if (option && !props.readOnly) props.onChange(option.value);
      }}
      optionValue="value"
      optionTextValue="label"
      optionDisabled={() => props.readOnly === true}
      disabled={props.disabled}
    >
      <Tooltip label="Set how this event repeats" placement="bottom">
        <Select.Trigger
          aria-label="Repeats"
          aria-readonly={props.readOnly || undefined}
          class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48')}
        >
          <Show when={!props.hideIcon}>
            <RepeatIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          </Show>
          <Select.Value<EventComposerSelectOption>>
            {(selectState) => selectState.selectedOption().label}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
      </Tooltip>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

export interface EventComposerCalendarPillProps {
  options: EventEditorCalendarOption[];
  value: EventEditorCalendarOption;
  onChange: (calendarId: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

/** Compact calendar property pill. */
export function EventComposerCalendarPill(
  props: EventComposerCalendarPillProps
) {
  return (
    <Select<EventEditorCalendarOption>
      options={props.options}
      value={props.value}
      onChange={(option) => {
        if (option && !props.readOnly) props.onChange(option.id);
      }}
      optionValue="id"
      optionTextValue="label"
      optionDisabled={() => props.readOnly === true}
      disabled={props.disabled}
    >
      <Tooltip label="Choose the calendar for this event" placement="bottom">
        <Select.Trigger
          aria-label="Calendar"
          aria-readonly={props.readOnly || undefined}
          class={cn(PROPERTY_TRIGGER_CLASS, 'w-40')}
        >
          <CalendarDotsIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
          <Select.Value<EventEditorCalendarOption>>
            {(selectState) => selectState.selectedOption().label}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
      </Tooltip>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
