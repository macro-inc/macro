import { PickerSheet } from '@components/app/mobile/PickerSheet';
import BellSimpleIcon from '@icon/system/regular/bell-simple.svg';
import CalendarDotsIcon from '@icon/system/regular/calendar-dots.svg';
import CalendarXIcon from '@icon/system/regular/calendar-x.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ChatTextIcon from '@icon/system/regular/chat-text.svg';
import MapPinIcon from '@icon/system/regular/map-pin.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import VideoCameraIcon from '@icon/system/regular/video-camera.svg';
import { Popover } from '@kobalte/core/popover';
import { useProperty } from '@property/core/context';
import { Root as PropertyRoot } from '@property/core/Root';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { OptionCheckBox } from '@property/editors/selectors/OptionCheckBox';
import { PropertyCaret } from '@property/extractors/PropertyCaret';
import { PropertyPill } from '@property/extractors/PropertyPill';
import type { EntityProperty } from '@property/types';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import { cn, Layer, Select, Tabs, Tooltip } from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
import {
  formatReminderOffset,
  REMINDER_OVERRIDES_MAX,
  REMINDER_PRESET_MINUTES,
} from '../../utils/event-reminders';
import { EventComposerPopoverPortal } from './EventComposerPopoverPortal';
import {
  AddOnlyGuestsEditor,
  EventGuestPicker,
  EventGuestRow,
  guestDisplayName,
} from './EventGuestsEditor';
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

// A disabled pill dims, as the date and time pills do, and takes no pointer,
// so it shows no hover; a tooltip around it still explains why.
const PROPERTY_TRIGGER_CLASS =
  'group flex h-7 items-center justify-between gap-1.5 rounded-full border border-edge-muted bg-control px-2 py-1 text-left text-xs leading-tight text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-ink focus-visible:ring-accent/10 data-expanded:bg-hover data-expanded:text-ink disabled:pointer-events-none disabled:opacity-50';
const PROPERTY_VALUE_CLASS =
  'group-hover:text-ink group-focus-visible:text-ink group-data-expanded:text-ink';

export type EventComposerSelectOption = {
  value: string;
  label: string;
};

const GUESTS_PROPERTY_ID = 'event-composer-guests';

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
  /** Why a read-only guest list cannot change, shown as a tooltip. */
  readOnlyReason?: string;
  /**
   * The organizer hides the guest list, so `selected` holds only the guests
   * the viewer may see and the pill names the list hidden instead.
   */
  guestListHidden?: boolean;
  /**
   * The event's current guests when the viewer may add guests but not remove
   * them; they stay in `selected` and the editor only adds to them.
   */
  currentGuests?: SelectedEventEditorGuest[];
  hideIcon?: boolean;
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
      <Tooltip
        label={props.readOnlyReason ?? ''}
        disabled={!props.readOnlyReason || open()}
      >
        <Popover.Trigger
          disabled={props.disabled}
          aria-label={props.guestListHidden ? 'Guest list hidden' : 'Guests'}
          aria-readonly="true"
          aria-description={props.readOnlyReason}
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
            {props.guestListHidden
              ? 'Guest list hidden'
              : guestPropertyLabel(props.selected)}
          </span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Popover.Trigger>
      </Tooltip>
      <EventComposerPopoverPortal>
        <Layer depth={3}>
          <Popover.Content class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-1.5 text-sm menu-open-animation">
            <Popover.Title class="sr-only">Event guests</Popover.Title>
            <Show when={props.readOnlyReason}>
              {(reason) => (
                <p class="px-2 pt-1 pb-2 text-xs text-ink-muted">{reason()}</p>
              )}
            </Show>
            <Show
              when={props.selected.length > 0}
              fallback={
                <Show when={!props.guestListHidden}>
                  <p class="px-2 py-4 text-center text-sm text-ink-muted">
                    No guests
                  </p>
                </Show>
              }
            >
              <div class="flex max-h-64 flex-col overflow-y-auto">
                <For each={props.selected}>
                  {(guest) => <EventGuestRow guest={guest} />}
                </For>
              </div>
            </Show>
          </Popover.Content>
        </Layer>
      </EventComposerPopoverPortal>
    </Popover>
  );
}

function EditableEventComposerGuestsPill(props: EventComposerGuestsPillProps) {
  return (
    <PropertyRoot
      property={guestsAsProperty(props.selected)}
      canEdit={!props.disabled}
    >
      <GuestsPillTrigger {...props} />
      <GuestsPopoverEditor
        selected={props.selected}
        currentGuests={props.currentGuests}
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
  selected: SelectedEventEditorGuest[];
  currentGuests?: SelectedEventEditorGuest[];
  options: Accessor<EventEditorGuestOption[]>;
  onChange: (selected: SelectedEventEditorGuest[]) => void;
}) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen()}>
      <EditorPopover portalScope="local">
        <GuestsEditor {...props} onClose={() => ctx.closeEditor()} />
      </EditorPopover>
    </Show>
  );
}

/** The add-only editor, or the picker, for guests chosen so far. */
function GuestsEditor(props: {
  selected: SelectedEventEditorGuest[];
  currentGuests?: SelectedEventEditorGuest[];
  options: Accessor<EventEditorGuestOption[]>;
  onChange: (selected: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
  /** Fill a sized container, such as a sheet, rather than a popover's height. */
  fillHeight?: boolean;
}) {
  return (
    <Show
      when={props.currentGuests}
      fallback={
        <EventGuestPicker
          options={props.options}
          selected={props.selected}
          onChange={props.onChange}
          onClose={props.onClose}
          fillHeight={props.fillHeight}
        />
      }
    >
      {(currentGuests) => {
        const isCurrent = (guest: SelectedEventEditorGuest) =>
          currentGuests().some(
            (current) =>
              guestEmail(current).toLowerCase() ===
              guestEmail(guest).toLowerCase()
          );
        return (
          <AddOnlyGuestsEditor
            options={props.options}
            current={currentGuests()}
            added={props.selected.filter((guest) => !isCurrent(guest))}
            onAddedChange={(added) =>
              props.onChange([...currentGuests(), ...added])
            }
            onClose={props.onClose}
          />
        );
      }}
    </Show>
  );
}

/**
 * The guest editor in a sheet stacked over the composer's. Picks stay a
 * draft until Done; Cancel, or dismissing the sheet, drops them.
 */
function GuestsSheetEditor(props: {
  selected: SelectedEventEditorGuest[];
  currentGuests?: SelectedEventEditorGuest[];
  options: Accessor<EventEditorGuestOption[]>;
  onChange: (selected: SelectedEventEditorGuest[]) => void;
}) {
  const ctx = useProperty();
  // Undefined until the first pick, so each opening starts from the event's guests.
  const [draft, setDraft] = createSignal<SelectedEventEditorGuest[]>();
  const shown = () => draft() ?? props.selected;
  const cancel = () => {
    setDraft(undefined);
    ctx.closeEditor();
  };
  const done = () => {
    const picked = draft();
    if (picked) props.onChange(picked);
    cancel();
  };

  return (
    <PickerSheet.Root open={ctx.editorOpen()} onCancel={cancel}>
      <PickerSheet.Header title="Guests" onDone={done} />
      <PickerSheet.Body>
        <GuestsEditor
          selected={shown()}
          currentGuests={props.currentGuests}
          options={props.options}
          onChange={setDraft}
          onClose={cancel}
          fillHeight
        />
      </PickerSheet.Body>
    </PickerSheet.Root>
  );
}

/** The guest pill for a touch sheet: it opens the guests in a sheet of their own. */
export function EventComposerGuestsSheetPill(
  props: EventComposerGuestsPillProps
) {
  return (
    <Show
      when={props.readOnly}
      fallback={
        <PropertyRoot
          property={guestsAsProperty(props.selected)}
          canEdit={!props.disabled}
        >
          <GuestsPillTrigger {...props} />
          <GuestsSheetEditor
            selected={props.selected}
            currentGuests={props.currentGuests}
            options={props.options}
            onChange={props.onChange}
          />
        </PropertyRoot>
      }
    >
      <ReadOnlyEventComposerGuestsPill {...props} />
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
      <EventComposerPopoverPortal>
        <Layer depth={3}>
          <Popover.Content
            class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-2 menu-open-animation"
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
              class="h-8 w-full rounded-md border border-edge-muted bg-control px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
            />
          </Popover.Content>
        </Layer>
      </EventComposerPopoverPortal>
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
const MICROSOFT_TEAMS_OPTION: EventComposerConferenceOption = {
  value: 'microsoft_teams',
  label: 'Microsoft Teams',
};
const MACRO_CALL_OPTION: EventComposerConferenceOption = {
  value: 'macro',
  label: 'Macro call',
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
  provider?: 'google_meet' | 'microsoft_teams' | 'other' | null;
  value: EventEditorConferenceChoice;
  canKeepExisting: boolean;
  macroCallsEnabled: boolean;
  onChange: (value: EventEditorConferenceChoice) => void;
  disabled?: boolean;
}

/** Compact selector for adding, replacing, or removing video conferencing. */
export function EventComposerConferencePill(
  props: EventComposerConferencePillProps
) {
  const includesMacroCall = createMemo(
    () => props.macroCallsEnabled || props.value === 'macro'
  );
  // The list must keep its identity while its contents do. A fresh array makes
  // the select re-assert its selection, which calls `onChange` again; with an
  // editor that rebuilds its state on every keystroke that is an endless loop.
  // The provider and the existing-conferencing flag reach us through accessors
  // that read the whole event, so each one is read through its own memo.
  const provider = createMemo(() => props.provider);
  const canKeepExisting = createMemo(() => props.canKeepExisting);
  const options = createMemo(() => [
    ...(includesMacroCall() ? [MACRO_CALL_OPTION] : []),
    ...(provider() === 'microsoft_teams'
      ? [MICROSOFT_TEAMS_OPTION]
      : provider() === null || provider() === 'other'
        ? []
        : [GOOGLE_MEET_OPTION]),
    ...(canKeepExisting() ? [EXISTING_CONFERENCING_OPTION] : []),
    NO_CONFERENCING_OPTION,
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
      <Select.Content portalScope="local">
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
      <Select.Content portalScope="local" class="w-56 p-0">
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
  /** Why a read-only rule cannot change, shown as a tooltip. */
  readOnlyReason?: string;
  /** Id of the line that explains the pill, such as its read-only reason. */
  describedBy?: string;
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
      {/* Always wrapped, so the reason coming and going never moves the
          trigger to a new parent. */}
      <Tooltip
        label={props.readOnlyReason ?? ''}
        disabled={!props.readOnlyReason}
      >
        <Select.Trigger
          aria-label="Repeats"
          aria-readonly={props.readOnly || undefined}
          aria-describedby={props.describedBy}
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
      <Select.Content portalScope="local">
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

export interface EventComposerCalendarPillProps {
  options: EventEditorCalendarOption[];
  value: EventEditorCalendarOption | undefined;
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
      placeholder="Choose calendar"
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
      <Select.Content portalScope="local">
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

/**
 * The kinds the composer offers; a read-only event shows whatever type it
 * has, including status types the composer cannot create.
 */
function createEventKindOptions(props: EventComposerKindPillProps) {
  return createMemo<EventComposerKindOption[]>(() =>
    props.readOnly
      ? [
          {
            value: eventKindOf(props.eventType),
            label: eventKindLabel(props.eventType),
          },
        ]
      : EVENT_KIND_OPTIONS
  );
}

/** The kinds of event as selectable labels, for a touch sheet. */
export function EventComposerKindTabs(props: EventComposerKindPillProps) {
  const options = createEventKindOptions(props);
  return (
    <Tabs
      aria-label="Event kind"
      options={options()}
      value={eventKindOf(props.eventType)}
      onChange={(kind) => {
        if (!props.readOnly) props.onChange(kind);
      }}
      disabled={props.disabled}
      touch="pills"
    />
  );
}

/** Compact selector for the kind of event being created. */
export function EventComposerKindPill(props: EventComposerKindPillProps) {
  const options = createEventKindOptions(props);
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
      <Select.Content portalScope="local">
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
      <Select.Content portalScope="local">
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
      <EventComposerPopoverPortal>
        <Layer depth={3}>
          <Popover.Content
            class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-2 menu-open-animation"
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
              class="h-8 w-full rounded-md border border-edge-muted bg-control px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
            />
          </Popover.Content>
        </Layer>
      </EventComposerPopoverPortal>
    </Popover>
  );
}
