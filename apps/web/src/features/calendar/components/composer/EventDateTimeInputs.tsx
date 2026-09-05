import type { CollectionNode } from '@kobalte/core';
import { Listbox } from '@kobalte/core/listbox';
import { Popover } from '@kobalte/core/popover';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, Show } from 'solid-js';
import { formatLocalDate, parseLocalDate } from '../../utils/calendar-date';
import {
  DAY_TIME_OPTIONS,
  type EventTimeOption,
  resolveTimeOption,
  selectedTimeOptionId,
} from './event-time-options';

export const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function TimeOptionItem(props: CollectionNode<EventTimeOption>) {
  return (
    <Listbox.Item
      item={props}
      class="group flex cursor-default items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-ink outline-none hover:bg-hover data-selected:bg-active data-highlighted:bg-hover"
    >
      <Listbox.ItemLabel>{props.rawValue.label}</Listbox.ItemLabel>
      <div class="flex shrink-0 items-center gap-2">
        <Show when={props.rawValue.detail}>
          {(detail) => (
            <span class="text-xs text-ink-extra-muted">{detail()}</span>
          )}
        </Show>
        <Listbox.ItemIndicator class="text-accent">
          <CheckIcon class="size-3.5" />
        </Listbox.ItemIndicator>
      </div>
    </Listbox.Item>
  );
}

interface EventTimeInputProps {
  id: string;
  label: string;
  value: string;
  /** Selectable times; defaults to every quarter-hour in a day. */
  options?: EventTimeOption[];
  /** Highlighted option; defaults to `value` on the anchor day. */
  selectedId?: string;
  onChange: (option: EventTimeOption) => void;
  onFocus?: () => void;
  disabled?: boolean;
  hideLabel?: boolean;
  class?: string;
}

export function EventTimeInput(props: EventTimeInputProps) {
  const [open, setOpen] = createSignal(false);
  let control: HTMLDivElement | undefined;
  let listbox: HTMLElement | undefined;

  const options = createMemo(() => props.options ?? DAY_TIME_OPTIONS);
  const selectedTime = createMemo(() => [
    props.selectedId ?? selectedTimeOptionId(props.value),
  ]);
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
    const id = values.values().next().value;
    if (typeof id !== 'string') return;
    const option = options().find((candidate) => candidate.id === id);
    if (option && id !== selectedTime()[0]) props.onChange(option);
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
            if (value && value !== props.value) {
              props.onChange(resolveTimeOption(options(), value));
            }
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
              options={options()}
              optionValue="id"
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

interface EventDateFieldProps {
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
