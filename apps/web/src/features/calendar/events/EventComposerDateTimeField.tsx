import type { CollectionNode } from '@kobalte/core';
import { Listbox } from '@kobalte/core/listbox';
import { Popover } from '@kobalte/core/popover';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import CheckIcon from '@phosphor/check.svg';
import { Calendar, Layer, Tooltip } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal } from 'solid-js';
import {
  EVENT_TIME_OPTIONS,
  type EventTimeOption,
  splitLocalDateTime,
} from './EventDateTimeField';

const timeLabelFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
});

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

export interface EventComposerDateTimeFieldProps {
  label: 'Start' | 'End';
  value: string;
  allDay: boolean;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
}

/** Date/time property pill used only by the standalone event composer. */
export function EventComposerDateTimeField(
  props: EventComposerDateTimeFieldProps
) {
  const [dateDraft, setDateDraft] = createSignal<string>();
  const [dateDraftDirty, setDateDraftDirty] = createSignal(false);
  const [timeDraft, setTimeDraft] = createSignal<string>();
  const [listboxRef, setListboxRef] = createSignal<HTMLElement>();

  let anchorRef: HTMLDivElement | undefined;

  const parts = () => splitLocalDateTime(props.value);
  const selectedDate = () => parseLocalDate(parts().date);

  const dateInputLabel = () =>
    selectedDate() ? dateLabelFormatter.format(selectedDate()) : 'Date';

  const selectedTimeValues = createMemo(() => [parts().time]);

  const tooltipLabel = () =>
    props.allDay
      ? `${props.label} date for this all-day event`
      : `${props.label} date and time for this event`;

  const updateDate = (date: string) => {
    props.onChange(props.allDay ? date : `${date}T${parts().time}`);
  };

  const updateTime = (time: string) => {
    props.onChange(`${parts().date}T${time}`);
  };

  const scrollToSelectedTime = () => {
    queueMicrotask(() => {
      listboxRef()
        ?.querySelector<HTMLElement>('[data-selected]')
        ?.scrollIntoView({ block: 'center' });
    });
  };

  const openPopup = () => {
    if (props.disabled) return;
    props.onOpenChange(true);
    if (!props.allDay) scrollToSelectedTime();
  };

  const close = () => {
    props.onOpenChange(false);
    setDateDraft(undefined);
    setDateDraftDirty(false);
    setTimeDraft(undefined);
  };

  const updateDateInput = (value: string) => {
    setDateDraft(value);
    setDateDraftDirty(true);
    const parsed = parseDateInput(value);
    if (parsed) updateDate(parsed);
  };

  const commitDateInput = (value: string) => {
    if (dateDraftDirty()) {
      const parsed = parseDateInput(value);
      if (parsed) updateDate(parsed);
    }

    setDateDraft(undefined);
    setDateDraftDirty(false);
  };

  const updateTimeInput = (value: string) => {
    setTimeDraft(value);
    const parsed = parseTimeInput(value);
    if (parsed) updateTime(parsed);
  };

  const selectTime = (values: Set<string>) => {
    const value = values.values().next().value;
    if (typeof value !== 'string') return;
    updateTime(value);
    close();
  };

  return (
    <Popover
      anchorRef={() => anchorRef}
      open={props.open && !props.disabled}
      onOpenChange={(next) => {
        if (next) openPopup();
        else close();
      }}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <Tooltip label={tooltipLabel()} placement="bottom" disabled={props.open}>
        <div
          ref={anchorRef}
          role="group"
          aria-label={props.label}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid || undefined}
          class={cn(
            'inline-grid h-7 min-w-0 grid-cols-[auto_auto] items-center gap-0 rounded-full border border-edge-muted bg-surface pl-1 pr-2 font-normal text-ink hover:bg-hover',
            props.open && 'bg-hover',
            props.invalid && 'border-failure',
            props.class
          )}
          onClick={openPopup}
          on:keydown={(event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <span class="flex min-w-0 items-center gap-1 px-1">
            {props.label === 'End' ? (
              <CalendarCheckIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            ) : (
              <CalendarBlankIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            )}
            <input
              type="text"
              value={dateDraft() ?? dateInputLabel()}
              aria-label={`${props.label} date`}
              aria-expanded={props.open}
              aria-haspopup="dialog"
              disabled={props.disabled}
              class="field-sizing-content min-w-0 flex-1 bg-transparent text-left text-xs font-normal text-ink outline-none disabled:cursor-not-allowed"
              onFocus={(event) => {
                openPopup();
                setDateDraft(dateInputLabel());
                setDateDraftDirty(false);
                event.currentTarget.select();
              }}
              onInput={(event) => updateDateInput(event.currentTarget.value)}
              onBlur={(event) => commitDateInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitDateInput(event.currentTarget.value);
                }
              }}
            />
          </span>
          <span class="flex h-full min-w-0 items-center gap-1">
            <span
              aria-hidden="true"
              class="inline-flex h-full shrink-0 items-center text-sm leading-none text-ink-extra-muted"
            >
              @
            </span>
            {props.allDay ? (
              <span class="text-xs">All day</span>
            ) : (
              <input
                type="text"
                value={timeDraft() ?? formatTimeLabel(parts().time)}
                aria-label={`${props.label} time`}
                aria-expanded={props.open}
                aria-haspopup="listbox"
                disabled={props.disabled}
                class="field-sizing-content h-full min-w-0 flex-1 bg-transparent text-left text-xs font-normal text-ink outline-none disabled:cursor-not-allowed"
                onFocus={(event) => {
                  openPopup();
                  setTimeDraft(formatTimeLabel(parts().time));
                  event.currentTarget.select();
                }}
                onInput={(event) => updateTimeInput(event.currentTarget.value)}
                onBlur={(event) => updateTimeInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    updateTimeInput(event.currentTarget.value);
                  }
                }}
              />
            )}
          </span>
        </div>
      </Tooltip>

      <Popover.Portal>
        <Layer depth={3}>
          {props.allDay ? (
            <Popover.Content
              class="z-action-menu w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu p-3 shadow-menu menu-open-animation"
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
                Choose {props.label.toLowerCase()} date
              </Popover.Title>
              <Calendar
                required
                fixedWeeks
                value={selectedDate()}
                onValueChange={(date) => {
                  if (!date) return;
                  updateDate(formatLocalDate(date));
                  close();
                }}
              />
            </Popover.Content>
          ) : (
            <Popover.Content
              class="portal-scope z-action-menu w-[24rem] max-w-[calc(100vw-1rem)] rounded-xl border border-edge bg-menu shadow-menu menu-open-animation"
              on:keydown={(event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
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
              <div class="grid grid-cols-[minmax(0,1fr)_9rem]">
                <div class="min-w-0 p-3">
                  <Calendar
                    required
                    fixedWeeks
                    value={selectedDate()}
                    onValueChange={(date) => {
                      if (!date) return;
                      updateDate(formatLocalDate(date));
                      setDateDraft(undefined);
                      setDateDraftDirty(false);
                    }}
                  />
                </div>
                <Listbox<EventTimeOption>
                  ref={setListboxRef}
                  options={EVENT_TIME_OPTIONS}
                  optionValue="value"
                  optionTextValue="label"
                  value={selectedTimeValues()}
                  onChange={selectTime}
                  selectionMode="single"
                  disallowEmptySelection
                  shouldFocusWrap
                  renderItem={(item) => <TimeOptionItem {...item} />}
                  class="max-h-64 overflow-y-auto border-l border-edge p-1.5"
                />
              </div>
            </Popover.Content>
          )}
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
