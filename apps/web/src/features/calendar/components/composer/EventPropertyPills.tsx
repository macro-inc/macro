import { UserIcon } from '@core/component/UserIcon';
import { type IUser, idToEmail, recipientEntityMapper } from '@core/user';
import { Popover } from '@kobalte/core/popover';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import CalendarDotsIcon from '@phosphor/calendar-dots.svg';
import CalendarXIcon from '@phosphor/calendar-x.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import RepeatIcon from '@phosphor/repeat.svg';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import { useProperty } from '@property/core/context';
import { Root as PropertyRoot } from '@property/core/Root';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { PropertyCaret } from '@property/extractors/PropertyCaret';
import { PropertyPill } from '@property/extractors/PropertyPill';
import type { EntityProperty } from '@property/types';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import { cn, Layer, Select } from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
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
import {
  type EventEditorEventKind,
  type EventEditorOutOfOffice,
  eventKindLabel,
  eventKindOf,
} from './out-of-office';

const PROPERTY_TRIGGER_CLASS =
  'group flex h-7 items-center justify-between gap-1.5 rounded-full border border-edge-muted bg-surface px-2 py-1 text-left text-xs leading-tight text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-ink focus-visible:ring-accent/10 data-expanded:bg-hover data-expanded:text-ink';
const PROPERTY_VALUE_CLASS =
  'group-hover:text-ink group-focus-visible:text-ink group-data-expanded:text-ink';

export type EventComposerSelectOption = {
  value: string;
  label: string;
};

const GUESTS_PROPERTY_ID = 'event-composer-guests';

function guestToUser(guest: SelectedEventEditorGuest): IUser {
  return {
    id: guest.id,
    email: guestEmail(guest),
    name: guestDisplayName(guest),
  };
}

function guestFromId(
  id: string,
  options: EventEditorGuestOption[],
  selected: SelectedEventEditorGuest[]
): SelectedEventEditorGuest {
  const option = options.find((guest) => guest.id === id);
  if (option) return option;
  const prior = selected.find((guest) => guest.id === id);
  if (prior) return prior;
  return recipientEntityMapper('custom')({
    id,
    email: idToEmail(id),
    invalid: false,
  });
}

function guestsAsProperty(
  selected: SelectedEventEditorGuest[]
): EntityProperty {
  return {
    propertyId: GUESTS_PROPERTY_ID,
    propertyDefinitionId: GUESTS_PROPERTY_ID,
    displayName: 'Guests',
    isMultiSelect: true,
    owner: { scope: 'system' },
    specificEntityType: 'USER',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    valueType: 'ENTITY',
    value: selected.map((guest) => ({
      entity_id: guest.id,
      entity_type: 'USER',
    })),
  };
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
            props.selected.length > 0 ? 'text-current' : 'text-ink-extra-muted'
          )}
        >
          {guestPropertyLabel(props.selected)}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Popover.Trigger>
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
  const users = createMemo((): IUser[] => {
    const byId = new Map<string, IUser>();
    for (const guest of props.options()) {
      byId.set(guest.id, guestToUser(guest));
    }
    for (const guest of props.selected) {
      byId.set(guest.id, guestToUser(guest));
    }
    return [...byId.values()];
  });

  return (
    <PropertyRoot
      property={guestsAsProperty(props.selected)}
      canEdit={!props.disabled}
    >
      <GuestsPillTrigger {...props} />
      <GuestsPopoverEditor
        users={users}
        selected={props.selected}
        options={props.options}
        onChange={props.onChange}
      />
    </PropertyRoot>
  );
}

function GuestsPillTrigger(props: EventComposerGuestsPillProps) {
  const ctx = useProperty();
  return (
    <PropertyPill
      aria-label="Guests"
      aria-expanded={ctx.editorOpen()}
      data-expanded={ctx.editorOpen() ? '' : undefined}
      class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
    >
      <Show when={!props.hideIcon}>
        <UsersIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
      </Show>
      <span
        class={cn(
          'min-w-0 truncate',
          PROPERTY_VALUE_CLASS,
          props.selected.length > 0 ? 'text-current' : 'text-ink-extra-muted'
        )}
      >
        {guestPropertyLabel(props.selected)}
      </span>
      <PropertyCaret class="text-ink-extra-muted" />
    </PropertyPill>
  );
}

function GuestsPopoverEditor(props: {
  users: Accessor<IUser[]>;
  selected: SelectedEventEditorGuest[];
  options: Accessor<EventEditorGuestOption[]>;
  onChange: (selected: SelectedEventEditorGuest[]) => void;
}) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen()}>
      <EditorPopover>
        <PropertyEntitySelector
          config={{
            isMultiSelect: true,
            placeholder: 'Add guests...',
            specificEntityType: 'USER',
            users: props.users,
            allowCustomEmail: true,
          }}
          selectedOptions={() =>
            new Set(props.selected.map((guest) => guest.id))
          }
          setSelectedOptions={(ids) => {
            props.onChange(
              [...ids].map((id) =>
                guestFromId(id, props.options(), props.selected)
              )
            );
          }}
          onClose={() => ctx.closeEditor()}
        />
      </EditorPopover>
    </Show>
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
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

interface EventComposerKindOption {
  value: EventEditorEventKind;
  label: string;
}

const EVENT_KIND_OPTIONS: EventComposerKindOption[] = [
  { value: 'default', label: 'Event' },
  { value: 'out_of_office', label: 'Out of office' },
];

export interface EventComposerKindPillProps {
  eventType: EventType | undefined;
  onChange: (kind: EventEditorEventKind) => void;
  disabled?: boolean;
  /** The provider event type is immutable, so edits show the kind fixed. */
  readOnly?: boolean;
}

/** Compact selector for the kind of event being created. */
export function EventComposerKindPill(props: EventComposerKindPillProps) {
  // A read-only pill displays whatever type the event has, including
  // status types the composer cannot create.
  const options = createMemo<EventComposerKindOption[]>(() =>
    props.readOnly
      ? [
          {
            value: eventKindOf(props.eventType),
            label: eventKindLabel(props.eventType),
          },
        ]
      : EVENT_KIND_OPTIONS
  );
  const selectedOption = () =>
    options().find((option) => option.value === eventKindOf(props.eventType)) ??
    options()[0];

  return (
    <Select<EventComposerKindOption>
      options={options()}
      value={selectedOption()}
      onChange={(option) => {
        if (option && !props.readOnly) props.onChange(option.value);
      }}
      optionValue="value"
      optionTextValue="label"
      optionDisabled={() => props.readOnly === true}
      disabled={props.disabled}
    >
      <Select.Trigger
        aria-label="Event kind"
        aria-readonly={props.readOnly || undefined}
        class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48')}
      >
        <SquaresFourIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
        <Select.Value<EventComposerKindOption>>
          {(selectState) => selectState.selectedOption().label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

interface EventComposerDeclineOption {
  value: EventEditorOutOfOffice['autoDeclineMode'];
  label: string;
}

const DECLINE_MODE_OPTIONS: EventComposerDeclineOption[] = [
  { value: 'decline_none', label: "Don't decline meetings" },
  {
    value: 'decline_only_new_conflicting_invitations',
    label: 'Decline new meetings',
  },
  {
    value: 'decline_all_conflicting_invitations',
    label: 'Decline all meetings',
  },
];

export interface EventComposerDeclinePillProps {
  /** Absent while editing an event whose stored settings are unknown. */
  value: EventEditorOutOfOffice | undefined;
  onChange: (value: EventEditorOutOfOffice) => void;
  disabled?: boolean;
}

/** Compact selector for how an out-of-office event declines meetings. */
export function EventComposerDeclinePill(props: EventComposerDeclinePillProps) {
  const selectedOption = () =>
    DECLINE_MODE_OPTIONS.find(
      (option) => option.value === props.value?.autoDeclineMode
    );

  return (
    <Select<EventComposerDeclineOption>
      options={DECLINE_MODE_OPTIONS}
      value={selectedOption() ?? null}
      onChange={(option) => {
        if (!option) return;
        props.onChange({
          autoDeclineMode: option.value,
          declineMessage: props.value?.declineMessage ?? '',
        });
      }}
      optionValue="value"
      optionTextValue="label"
      placeholder="Decline settings"
      disabled={props.disabled}
    >
      <Select.Trigger
        aria-label="Decline meetings"
        class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
      >
        <CalendarXIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
        <Select.Value<EventComposerDeclineOption>>
          {(selectState) => (
            <span class={cn('truncate', PROPERTY_VALUE_CLASS)}>
              {selectState.selectedOption().label}
            </span>
          )}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

export interface EventComposerDeclineMessagePillProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Compact editable pill for the auto-decline reply message. */
export function EventComposerDeclineMessagePill(
  props: EventComposerDeclineMessagePillProps
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
      <Popover.Trigger
        disabled={props.disabled}
        aria-label="Decline message"
        class={cn(PROPERTY_TRIGGER_CLASS, 'max-w-48 overflow-hidden')}
      >
        <ChatTextIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
        <span
          class={cn(
            'min-w-0 truncate',
            PROPERTY_VALUE_CLASS,
            props.value ? 'text-current' : 'text-ink-extra-muted'
          )}
        >
          {props.value || 'Add decline message'}
        </span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="z-action-menu w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu p-2 shadow-menu menu-open-animation"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(() => input?.focus());
            }}
          >
            <Popover.Title class="sr-only">Decline message</Popover.Title>
            <input
              ref={input}
              type="text"
              value={props.value}
              onInput={(event) => props.onChange(event.currentTarget.value)}
              placeholder="Add decline message..."
              aria-label="Decline message"
              disabled={props.disabled}
              class="h-8 w-full rounded-md border border-edge-muted bg-surface px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
