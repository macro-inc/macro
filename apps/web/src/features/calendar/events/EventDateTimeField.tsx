import type { CollectionNode } from '@kobalte/core';
import { Listbox } from '@kobalte/core/listbox';
import { Popover } from '@kobalte/core/popover';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, createUniqueId } from 'solid-js';

export interface EventTimeOption {
  value: string;
  label: string;
}

export const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
export const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Every quarter-hour in a day, with canonical values and localized labels. */
export const EVENT_TIME_OPTIONS: EventTimeOption[] = Array.from(
  { length: 24 * 4 },
  (_, index) => {
    const hour = Math.floor(index / 4);
    const minute = (index % 4) * 15;
    return {
      value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      label: timeLabelFormatter.format(new Date(2000, 0, 1, hour, minute)),
    };
  }
);

export function splitLocalDateTime(value: string) {
  const separator = value.indexOf('T');
  if (separator === -1) return { date: value, time: '' };
  return {
    date: value.slice(0, separator),
    time: value.slice(separator + 1, separator + 6),
  };
}

export function withLocalDate(value: string, date: string) {
  return `${date}T${splitLocalDateTime(value).time}`;
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

export function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string) {
  const localDate = parseLocalDate(value.trim());
  if (localDate) return formatLocalDate(localDate);

  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : formatLocalDate(parsed);
}

export function withLocalTime(value: string, time: string) {
  return `${splitLocalDateTime(value).date}T${time}`;
}

function parseTimeInput(value: string) {
  const match = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i.exec(
    value.trim().replaceAll('.', '')
  );
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3]?.toLowerCase();
  if (minute > 59) return undefined;

  if (period) {
    if (hour < 1 || hour > 12) return undefined;
    if (period === 'am' && hour === 12) hour = 0;
    if (period === 'pm' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return undefined;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatTimeLabel(value: string) {
  const parsed = parseTimeInput(value);
  if (!parsed) return 'Time';
  const [hour = 0, minute = 0] = parsed.split(':').map(Number);
  return timeLabelFormatter.format(new Date(2000, 0, 1, hour, minute));
}

function TimeOptionItem(props: CollectionNode<EventTimeOption>) {
  return (
    <Listbox.Item
      item={props}
      class="group flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm text-ink outline-none hover:bg-hover data-selected:bg-active data-highlighted:bg-hover"
    >
      <Listbox.ItemLabel>{props.rawValue.label}</Listbox.ItemLabel>
      <Listbox.ItemIndicator class="text-accent">
        <CheckIcon class="size-3.5" />
      </Listbox.ItemIndicator>
    </Listbox.Item>
  );
}

export interface EventTimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  disabled?: boolean;
  hideLabel?: boolean;
  class?: string;
}

export function EventTimeInput(props: EventTimeInputProps) {
  const [open, setOpen] = createSignal(false);
  let control: HTMLDivElement | undefined;
  let listbox: HTMLElement | undefined;

  const selectedTime = createMemo(() => [props.value]);
  const scrollToSelectedTime = () => {
    requestAnimationFrame(() => {
      listbox
        ?.querySelector<HTMLElement>('[data-selected]')
        ?.scrollIntoView({ block: 'center' });
    });
  };
  const setDropdownOpen = (nextOpen: boolean) => {
    if (props.disabled) return;
    setOpen(nextOpen);
    if (nextOpen) scrollToSelectedTime();
  };
  const selectTime = (values: Set<string>) => {
    const value = values.values().next().value;
    if (typeof value !== 'string') return;
    if (value !== props.value) props.onChange(value);
    setOpen(false);
  };

  return (
    <Popover
      anchorRef={() => control}
      open={open() && !props.disabled}
      onOpenChange={setDropdownOpen}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      {!props.hideLabel && (
        <label for={props.id} class="block text-xxs font-medium text-ink-muted">
          {props.label}
        </label>
      )}
      <div
        ref={control}
        class={cn('relative', !props.hideLabel && 'mt-1', props.class)}
      >
        <input
          id={props.id}
          type="time"
          step={900}
          value={props.value}
          disabled={props.disabled}
          aria-expanded={open()}
          aria-haspopup="listbox"
          class="w-full appearance-none rounded-md border border-edge-muted bg-surface py-1.5 pr-7 pl-2 text-xs text-ink outline-none focus:border-accent disabled:opacity-50 [&::-webkit-calendar-picker-indicator]:hidden"
          onFocus={() => {
            props.onFocus?.();
            setDropdownOpen(true);
          }}
          onClick={() => setDropdownOpen(true)}
          onInput={(event) => {
            const value = event.currentTarget.value;
            if (value && value !== props.value) props.onChange(value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open()) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
        />
        <CaretDownIcon
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-ink-extra-muted"
        />
      </div>

      <Popover.Portal>
        <Layer depth={4}>
          <Popover.Content
            class="z-action-menu max-h-64 min-w-[var(--kb-popper-anchor-width)] overflow-y-auto rounded-xl border border-edge bg-menu p-1.5 shadow-menu menu-open-animation"
            style={{
              'z-index': 'calc(var(--z-index-action-menu) + 1)',
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && control?.contains(target)) {
                event.preventDefault();
              }
            }}
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
          >
            <Popover.Title class="sr-only">
              Choose {props.label.toLowerCase()}
            </Popover.Title>
            <Listbox<EventTimeOption>
              ref={(element) => {
                listbox = element;
              }}
              options={EVENT_TIME_OPTIONS}
              optionValue="value"
              optionTextValue="label"
              value={selectedTime()}
              onChange={selectTime}
              selectionMode="single"
              disallowEmptySelection
              shouldFocusWrap
              renderItem={(item) => <TimeOptionItem {...item} />}
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}

export interface EventDateTimePopoverContentProps {
  label: string;
  date: string;
  time?: string;
  onDateChange: (date: string) => void;
  onTimeChange?: (time: string) => void;
  disabled?: boolean;
}

/** Calendar and optional native time input shared by event date/time popovers. */
export function EventDateTimePopoverContent(
  props: EventDateTimePopoverContentProps
) {
  const fieldId = createUniqueId();
  const selectedDate = createMemo(
    () => parseLocalDate(props.date) ?? new Date()
  );

  return (
    <div
      class={cn(
        props.time !== undefined && 'grid grid-cols-[minmax(0,1fr)_11rem]'
      )}
    >
      <div class="min-w-0 p-3">
        <Calendar
          required
          value={selectedDate()}
          onValueChange={(date) => {
            if (date) props.onDateChange(formatLocalDate(date));
          }}
        />
      </div>
      {props.time !== undefined && (
        <div class="min-w-0 border-l border-edge p-3">
          <EventTimeInput
            id={`event-${props.label.toLowerCase()}-time-${fieldId}`}
            label={`${props.label} time`}
            value={props.time ?? ''}
            onChange={(time) => props.onTimeChange?.(time)}
            disabled={props.disabled}
          />
        </div>
      )}
    </div>
  );
}

export interface EventDateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
  portalScope?: 'local';
  appearance?: 'underline' | 'bare';
}

/** Compact calendar date selector used by event date/time ranges. */
export function EventDateField(props: EventDateFieldProps) {
  const [open, setOpen] = createSignal(false);
  const [portalSearchRef, setPortalSearchRef] = createSignal<HTMLDivElement>();
  const selectedDate = () => parseLocalDate(props.value);
  const portalMount = () => {
    if (props.portalScope !== 'local') return undefined;
    return (
      portalSearchRef()?.closest<HTMLElement>('.portal-scope') ?? undefined
    );
  };

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={(next) => setOpen(!props.disabled && next)}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Popover.Trigger
        aria-label={`${props.label} date`}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid || undefined}
        title={selectedDate() ? dateLabelFormatter.format(selectedDate()) : ''}
        disabled={props.disabled}
        class={cn(
          'flex min-w-0 items-center justify-start gap-1 truncate bg-transparent text-xs font-normal outline-none disabled:cursor-not-allowed',
          props.appearance === 'bare'
            ? 'px-0'
            : 'h-9 border-b border-edge-muted px-1 focus-visible:border-accent',
          props.invalid && 'border-failure',
          props.class
        )}
      >
        <CalendarBlankIcon class="size-3 shrink-0 text-ink-extra-muted" />
        <span class="truncate">
          {selectedDate() ? dateLabelFormatter.format(selectedDate()) : 'Date'}
        </span>
      </Popover.Trigger>

      <div class="hidden" ref={setPortalSearchRef} />
      <Popover.Portal mount={portalMount()}>
        <Layer depth={3}>
          <Popover.Content class="z-action-menu w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu p-3 shadow-menu menu-open-animation">
            <Popover.Title class="sr-only">
              Choose {props.label.toLowerCase()} date
            </Popover.Title>
            <Calendar
              required
              fixedWeeks
              value={selectedDate()}
              onValueChange={(date) => {
                if (!date) return;
                props.onChange(formatLocalDate(date));
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}

export interface EventDateTimeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
  portalScope?: 'local';
  appearance?: 'underline' | 'bare';
}

/** Editable date/time fields with one popup for calendar and time selection. */
export function EventDateTimeField(props: EventDateTimeFieldProps) {
  const [open, setOpen] = createSignal(false);
  const [dateDraft, setDateDraft] = createSignal<string>();
  const [dateDraftDirty, setDateDraftDirty] = createSignal(false);
  const [timeDraft, setTimeDraft] = createSignal<string>();
  const [portalSearchRef, setPortalSearchRef] = createSignal<HTMLDivElement>();
  let anchorRef: HTMLDivElement | undefined;

  const date = () => splitLocalDateTime(props.value).date;
  const time = () => splitLocalDateTime(props.value).time;
  const selectedDate = () => parseLocalDate(date());
  const dateInputLabel = () =>
    selectedDate() ? dateLabelFormatter.format(selectedDate()) : 'Date';
  const portalMount = () => {
    if (props.portalScope !== 'local') return undefined;
    return (
      portalSearchRef()?.closest<HTMLElement>('.portal-scope') ?? undefined
    );
  };
  const openPopup = () => {
    if (props.disabled) return;
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setDateDraft(undefined);
    setDateDraftDirty(false);
    setTimeDraft(undefined);
  };
  const updateDateInput = (value: string) => {
    setDateDraft(value);
    setDateDraftDirty(true);
    const parsed = parseDateInput(value);
    if (parsed) props.onChange(withLocalDate(props.value, parsed));
  };
  const commitDateInput = (value: string) => {
    if (dateDraftDirty()) {
      const parsed = parseDateInput(value);
      if (parsed) props.onChange(withLocalDate(props.value, parsed));
    }
    setDateDraft(undefined);
    setDateDraftDirty(false);
  };
  const updateTimeInput = (value: string) => {
    setTimeDraft(value);
    const parsed = parseTimeInput(value);
    if (parsed) props.onChange(withLocalTime(props.value, parsed));
  };
  const commitTimeInput = (value: string) => {
    updateTimeInput(value);
    setTimeDraft(undefined);
  };
  return (
    <Popover
      anchorRef={() => anchorRef}
      open={open() && !props.disabled}
      onOpenChange={(next) => {
        if (next) openPopup();
        else close();
      }}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <div
        ref={anchorRef}
        role="group"
        aria-label={props.label}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid || undefined}
        class={cn(
          'grid min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-1 bg-transparent',
          props.appearance === 'bare'
            ? 'px-0'
            : 'h-9 border-b border-edge-muted px-0 focus-within:border-accent',
          props.invalid && 'border-failure',
          props.class
        )}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <span class="flex min-w-0 items-center gap-1 px-1">
          <CalendarBlankIcon class="size-3 shrink-0 text-ink-extra-muted" />
          <input
            type="text"
            value={dateDraft() ?? dateInputLabel()}
            aria-label={`${props.label} date`}
            aria-expanded={open()}
            aria-haspopup="dialog"
            disabled={props.disabled}
            class="min-w-0 flex-1 bg-transparent text-left text-xs text-ink outline-none disabled:cursor-not-allowed"
            onFocus={(event) => {
              openPopup();
              setDateDraft(dateInputLabel());
              setDateDraftDirty(false);
              event.currentTarget.select();
            }}
            onClick={openPopup}
            onInput={(event) => updateDateInput(event.currentTarget.value)}
            onBlur={(event) => commitDateInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitDateInput(event.currentTarget.value);
              }
            }}
          />
        </span>
        <input
          type="text"
          value={timeDraft() ?? formatTimeLabel(time())}
          aria-label={`${props.label} time`}
          aria-expanded={open()}
          aria-haspopup="listbox"
          disabled={props.disabled}
          class="min-w-0 bg-transparent text-left text-xs text-ink outline-none disabled:cursor-not-allowed"
          onFocus={(event) => {
            openPopup();
            setTimeDraft(formatTimeLabel(time()));
            event.currentTarget.select();
          }}
          onClick={openPopup}
          onInput={(event) => updateTimeInput(event.currentTarget.value)}
          onBlur={(event) => commitTimeInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitTimeInput(event.currentTarget.value);
            }
          }}
        />
      </div>

      <div class="hidden" ref={setPortalSearchRef} />
      <Popover.Portal mount={portalMount()}>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-action-menu w-[31rem] max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu shadow-menu menu-open-animation"
            onInteractOutside={(event) => {
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && anchorRef?.contains(target)) {
                event.preventDefault();
              }
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              Choose {props.label.toLowerCase()} date and time
            </Popover.Title>
            <EventDateTimePopoverContent
              label={props.label}
              date={date()}
              time={time()}
              onDateChange={(nextDate) => {
                props.onChange(withLocalDate(props.value, nextDate));
                setDateDraft(undefined);
                setDateDraftDirty(false);
              }}
              onTimeChange={(nextTime) => {
                props.onChange(withLocalTime(props.value, nextTime));
                setTimeDraft(undefined);
              }}
              disabled={props.disabled}
            />
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
