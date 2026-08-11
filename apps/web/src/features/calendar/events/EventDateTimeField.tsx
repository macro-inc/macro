import type { CollectionNode } from '@kobalte/core';
import { Listbox } from '@kobalte/core/listbox';
import { Popover } from '@kobalte/core/popover';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import {
  Calendar,
  CalendarRange,
  type CalendarRangeValue,
} from '@ui/components/Calendar';
import { Checkbox } from '@ui/components/Checkbox';
import { Layer } from '@ui/components/Layer';
import { Tooltip } from '@ui/components/Tooltip';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, createUniqueId } from 'solid-js';

const UNDERLINE_INPUT_CLASS =
  'rounded-none! border-x-0! border-t-0! border-b! px-0! sm:text-xs!';

export interface EventTimeOption {
  value: string;
  label: string;
}

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
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

function withLocalDate(value: string, date: string) {
  return `${date}T${splitLocalDateTime(value).time}`;
}

function parseLocalDate(value: string) {
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

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string) {
  const localDate = parseLocalDate(value.trim());
  if (localDate) return formatLocalDate(localDate);

  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : formatLocalDate(parsed);
}

function withLocalTime(value: string, time: string) {
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

interface EventTimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  disabled?: boolean;
}

function EventTimeInput(props: EventTimeInputProps) {
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
      <label for={props.id} class="block text-xxs font-medium text-ink-muted">
        {props.label}
      </label>
      <div ref={control} class="relative mt-1">
        <input
          id={props.id}
          type="time"
          step={900}
          value={props.value}
          disabled={props.disabled}
          aria-expanded={open()}
          aria-haspopup="listbox"
          class="h-7 w-full appearance-none rounded-md border border-edge-muted bg-surface py-1 pr-7 pl-2 text-xs text-ink outline-none focus:border-accent [&::-webkit-calendar-picker-indicator]:hidden"
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
        <button
          type="button"
          disabled={props.disabled}
          aria-label={`Choose ${props.label.toLowerCase()}`}
          aria-expanded={open()}
          class="absolute inset-y-0 right-0 flex w-7 items-center justify-center rounded-r-md text-ink-extra-muted hover:bg-hover focus-visible:bg-active"
          onClick={() => setDropdownOpen(!open())}
        >
          <CaretDownIcon class="size-3" />
        </button>
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
          'settings-input flex h-9 min-w-0 items-center justify-start gap-1 truncate rounded-none! border-x-0! border-t-0! border-b! px-1! text-xs font-normal disabled:cursor-not-allowed',
          props.invalid && 'border-b-failure!',
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

export interface EventDateTimeRangePillProps {
  start: string;
  end: string;
  allDay: boolean;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAllDayChange: (allDay: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** Combined composer date-range pill backed by a range and time popover. */
export function EventDateTimeRangePill(props: EventDateTimeRangePillProps) {
  const fieldId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [activeEndpoint, setActiveEndpoint] = createSignal<'start' | 'end'>(
    'start'
  );
  const [rangeDraft, setRangeDraft] = createSignal<CalendarRangeValue>();
  let pill: HTMLButtonElement | undefined;

  const startParts = () => splitLocalDateTime(props.start);
  const endParts = () => splitLocalDateTime(props.end);
  const currentRange = createMemo<CalendarRangeValue>(() => ({
    from: parseLocalDate(startParts().date) ?? null,
    to: parseLocalDate(endParts().date) ?? null,
  }));
  const displayedRange = () => rangeDraft() ?? currentRange();
  const dateLabel = (date: Date | null, fallback: string) =>
    date ? dateLabelFormatter.format(date) : fallback;
  const withDate = (value: string, date: string) =>
    props.allDay ? date : withLocalDate(value, date);
  const changeRange = (range: CalendarRangeValue) => {
    setRangeDraft(range);
    if (!range.from) {
      setActiveEndpoint('start');
      return;
    }
    if (!range.to) {
      setActiveEndpoint('end');
      return;
    }
    setActiveEndpoint('start');
    props.onStartChange(withDate(props.start, formatLocalDate(range.from)));
    props.onEndChange(withDate(props.end, formatLocalDate(range.to)));
  };
  const openPopover = () => {
    if (props.disabled) return;
    setRangeDraft(currentRange());
    setActiveEndpoint('start');
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setRangeDraft(undefined);
  };

  return (
    <Popover
      anchorRef={() => pill}
      open={open() && !props.disabled}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openPopover();
        } else {
          close();
        }
      }}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Tooltip
        label="Set the event date and time range"
        placement="bottom"
        disabled={open()}
      >
        <button
          ref={pill}
          type="button"
          disabled={props.disabled}
          aria-label="Edit event date and time range"
          aria-expanded={open()}
          aria-haspopup="dialog"
          aria-invalid={props.invalid || undefined}
          aria-describedby={props.describedBy}
          class={cn(
            'inline-flex h-7 min-w-0 max-w-full items-center rounded-full border border-edge-muted bg-surface px-1 text-left font-normal text-ink transition-colors hover:bg-hover focus-visible:bg-active focus-visible:ring-accent/10',
            open() && 'bg-hover',
            props.invalid && 'border-failure'
          )}
          onClick={() => (open() ? close() : openPopover())}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open()) return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <span
            class={cn(
              '-ml-1 flex h-full min-w-0 items-center gap-1 rounded-full pr-1.5 pl-2',
              open() &&
                activeEndpoint() === 'start' &&
                'bg-accent-bg text-accent ring ring-inset ring-accent/20 [&_svg]:text-accent'
            )}
          >
            <CalendarBlankIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            <span class="truncate text-xs">
              {dateLabel(displayedRange().from, 'Start date')}
            </span>
            {!props.allDay && (
              <span class="shrink-0 text-xs">
                {formatTimeLabel(startParts().time)}
              </span>
            )}
          </span>
          <ArrowRightIcon
            aria-label="to"
            class="mx-1 size-3 shrink-0 text-ink-extra-muted"
          />
          <span
            class={cn(
              '-mr-1 flex h-full min-w-0 items-center gap-1 rounded-full pr-2 pl-1.5',
              open() &&
                activeEndpoint() === 'end' &&
                'bg-accent-bg text-accent ring ring-inset ring-accent/20 [&_svg]:text-accent'
            )}
          >
            <span class="truncate text-xs">
              {dateLabel(displayedRange().to, 'End date')}
            </span>
            {!props.allDay && (
              <span class="shrink-0 text-xs">
                {formatTimeLabel(endParts().time)}
              </span>
            )}
            <CaretDownIcon class="ml-1 size-3 shrink-0 text-ink-extra-muted" />
          </span>
        </button>
      </Tooltip>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-action-menu w-[31rem] max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu shadow-menu menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              Choose event date and time range
            </Popover.Title>
            <div class="grid grid-cols-[minmax(0,1fr)_11rem]">
              <div class="min-w-0 p-3">
                <CalendarRange
                  required
                  fixedWeeks
                  value={rangeDraft() ?? currentRange()}
                  onValueChange={changeRange}
                />
              </div>
              <div class="flex min-w-0 flex-col gap-3 border-l border-edge p-3">
                {!props.allDay && (
                  <>
                    <EventTimeInput
                      id={`event-start-time-${fieldId}`}
                      label="Start time"
                      value={startParts().time}
                      onChange={(time) =>
                        props.onStartChange(withLocalTime(props.start, time))
                      }
                      onFocus={() => setActiveEndpoint('start')}
                      disabled={props.disabled}
                    />
                    <EventTimeInput
                      id={`event-end-time-${fieldId}`}
                      label="End time"
                      value={endParts().time}
                      onChange={(time) =>
                        props.onEndChange(withLocalTime(props.end, time))
                      }
                      onFocus={() => setActiveEndpoint('end')}
                      disabled={props.disabled}
                    />
                  </>
                )}
                <Checkbox
                  checked={props.allDay}
                  disabled={props.disabled}
                  onChange={props.onAllDayChange}
                  class="mt-auto text-xs text-ink-muted"
                >
                  <Checkbox.Control />
                  <Checkbox.Label>All day</Checkbox.Label>
                </Checkbox>
              </div>
            </div>
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
          'settings-input grid h-9 min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-1 focus-within:border-accent',
          UNDERLINE_INPUT_CLASS,
          props.invalid && 'border-b-failure!',
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
          class="h-full min-w-0 bg-transparent text-left text-xs text-ink outline-none disabled:cursor-not-allowed"
          onFocus={(event) => {
            openPopup();
            setTimeDraft(formatTimeLabel(time()));
            event.currentTarget.select();
          }}
          onClick={openPopup}
          onInput={(event) => updateTimeInput(event.currentTarget.value)}
          onBlur={(event) => updateTimeInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              updateTimeInput(event.currentTarget.value);
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
