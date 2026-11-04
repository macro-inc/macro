import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import { Popover } from '@kobalte/core/popover';
import { mergeRefs } from '@solid-primitives/refs';
import {
  type ComponentProps,
  createMemo,
  createSignal,
  createUniqueId,
  Show,
  splitProps,
} from 'solid-js';
import { cn } from '../utils/classname';
import { formatDateValue, parseDateValue } from '../utils/date';
import { Button } from './Button';
import { Calendar } from './Calendar';
import { type InputSize, inputClasses } from './Input';

export type DatePickerProps = Omit<
  ComponentProps<'button'>,
  'value' | 'onChange' | 'children' | 'type'
> & {
  /** A date-only value in YYYY-MM-DD format. An empty string clears the field. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive date-only bounds. */
  min?: string;
  max?: string;
  required?: boolean;
  placeholder?: string;
  size?: InputSize;
};

/**
 * A date-only field with an accessible mini-calendar popover.
 *
 * @do Keep values as YYYY-MM-DD strings; time-zone conversion belongs to the caller.
 * @do Supply an accessible name with aria-label or aria-labelledby.
 * @dont Use for times or date ranges; compose separate fields for range endpoints.
 */
export function DatePicker(props: DatePickerProps) {
  const [local, rest] = splitProps(props, [
    'value',
    'onChange',
    'min',
    'max',
    'required',
    'placeholder',
    'size',
    'class',
    'disabled',
    'name',
    'form',
    'ref',
    'aria-label',
    'aria-describedby',
  ]);
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  let content: HTMLDivElement | undefined;
  const valueId = createUniqueId();
  const selected = createMemo(() => parseDateValue(local.value));
  const format = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const displayValue = () => {
    const date = selected();
    return date ? format.format(date) : (local.placeholder ?? 'Select date');
  };
  const disabledDate = (date: Date) => {
    const value = formatDateValue(date);
    const min = local.min;
    const max = local.max;
    return (
      !!local.disabled ||
      (!!min && !!parseDateValue(min) && value < min) ||
      (!!max && !!parseDateValue(max) && value > max)
    );
  };
  const initialDate = () => {
    const date = selected() ?? new Date();
    const min = parseDateValue(local.min);
    const max = parseDateValue(local.max);
    const value = formatDateValue(date);
    if (min && value < formatDateValue(min)) return min;
    if (max && value > formatDateValue(max)) return max;
    return date;
  };
  const choose = (value: string) => {
    local.onChange(value);
    setOpen(false);
  };

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={6}
      modal={false}
    >
      <Popover.Trigger
        ref={mergeRefs(setTrigger, local.ref)}
        type="button"
        disabled={local.disabled}
        data-date-picker
        form={local.form}
        aria-label={local['aria-label'] ?? 'Choose date'}
        aria-describedby={[local['aria-describedby'], valueId]
          .filter(Boolean)
          .join(' ')}
        class={inputClasses({
          size: local.size,
          class: cn(
            'flex items-center justify-between gap-2 text-left font-normal',
            local.class
          ),
        })}
        {...rest}
      >
        <span
          id={valueId}
          class="min-w-0 truncate"
          classList={{ 'text-ink-placeholder': !selected() }}
        >
          {displayValue()}
        </span>
        <CalendarIcon
          aria-hidden="true"
          class="size-4 shrink-0 text-ink-muted"
        />
      </Popover.Trigger>
      {/* Native form semantics without exposing the browser's date picker. */}
      <input
        type="date"
        class="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        name={local.name}
        form={local.form}
        min={local.min}
        max={local.max}
        value={selected() ? local.value : ''}
        required={local.required}
        disabled={local.disabled}
        onInvalid={(event) => {
          event.preventDefault();
          trigger()?.focus();
          setOpen(true);
        }}
      />
      <Popover.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Popover.Content
          ref={content}
          data-date-picker-content
          class="menu-surface z-action-menu w-64 touch:w-72 max-w-[min(var(--kb-popper-content-available-width),calc(100vw-1rem))] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto p-3 outline-none"
          on:keydown={(event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Corvu drawers and Kobalte popovers have separate dismissal stacks.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
          onOpenAutoFocus={(event) => {
            // Start arrow-key navigation on the selected (or nearest allowed) day.
            const day = content?.querySelector<HTMLElement>(
              '[data-corvu-calendar-celltrigger][tabindex="0"]'
            );
            if (day) {
              event.preventDefault();
              // Let Kobalte register the nested layer before moving focus.
              queueMicrotask(() => {
                if (open() && day.isConnected)
                  day.focus({ preventScroll: true });
              });
            }
          }}
        >
          <Popover.Title class="sr-only">
            {local['aria-label'] ?? 'Choose date'}
          </Popover.Title>
          <Calendar
            class="touch:[&_[data-corvu-calendar-celltrigger]]:size-9 touch:[&_[data-corvu-calendar-nav]]:size-9"
            value={selected() ?? null}
            initialMonth={initialDate()}
            initialFocusedDay={initialDate()}
            required
            fixedWeeks
            disabled={disabledDate}
            onValueChange={(date) => date && choose(formatDateValue(date))}
          />
          <div class="mt-2 flex items-center justify-between gap-2 border-t border-edge-muted pt-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={disabledDate(new Date())}
              onClick={() => choose(formatDateValue(new Date()))}
            >
              Today
            </Button>
            <Show when={!local.required}>
              <Button
                size="sm"
                variant="ghost"
                disabled={!selected()}
                onClick={() => choose('')}
              >
                Clear
              </Button>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
