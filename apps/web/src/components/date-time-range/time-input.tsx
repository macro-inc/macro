import { formatLocale } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckIcon from '@icon/system/regular/check.svg';
import { Popover } from '@kobalte/core/popover';
import { Dropdown } from '@ui/components/Dropdown';
import { Input } from '@ui/components/Input';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createMemo, createUniqueId, For, onCleanup, Show } from 'solid-js';
import type { ClockFormat } from './primitives/clock-format';
import { createTimeInput } from './primitives/create-time-input';
import { editableClockValue } from './primitives/mobile-clock-value';
import {
  observeTimeOptionViewport,
  revealTimeOption,
} from './primitives/reveal-time-option';
import {
  dayTimeOptions,
  formatTimeValue,
  selectedTimeOptionId,
  type TimeOption,
} from './time-options';

export const dateLabelFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

interface TimeInputProps {
  id: string;
  /** Accessible name, e.g. `Start time`. */
  label: string;
  /** `HH:mm`, or empty. */
  value: string;
  /** Explicit calendar clock preference; omitted keeps the locale's default. */
  timeFormat?: ClockFormat;
  /** Selectable times; defaults to every quarter-hour in a day. */
  options?: TimeOption[];
  /** Highlighted option; defaults to `value` on the anchor day. */
  selectedId?: string;
  onChange: (option: TimeOption) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
  /** Keep the numeric input and meridiem in fixed columns while resting or typing. */
  splitMeridiem?: boolean;
}

/**
 * A clock time typed or picked from a list, as Google Calendar's time fields
 * work: typing `3`, `3p`, `330` or `15:30` jumps the list to that time and
 * fills in the rest of its label; Enter, Tab or leaving the field commits,
 * Escape puts the old time back.
 */
export function TimeInput(props: TimeInputProps) {
  const listId = createUniqueId();
  let input!: HTMLInputElement;
  const periodId = `${listId}-period`;
  let list: HTMLDivElement | undefined;

  const options = createMemo(
    () => props.options ?? dayTimeOptions(props.timeFormat)
  );
  const selectedId = () =>
    props.selectedId ?? selectedTimeOptionId(props.value);
  const model = createTimeInput({
    options,
    selectedId,
    disabled: () => props.disabled ?? false,
    timeFormat: () => props.timeFormat,
    onChange: (option) => props.onChange(option),
  });
  const display = () =>
    editableClockValue(
      props.value,
      model.state.shown,
      model.state.navigated || model.state.typed !== undefined
        ? model.highlighted()?.value
        : undefined,
      props.timeFormat,
      formatLocale()
    );
  const optionDomId = (option: TimeOption) =>
    `${listId}-${option.id.replace('|', '-')}`;
  const activeDescendant = () => {
    const option = model.isOpen() ? model.highlighted() : undefined;
    return option ? optionDomId(option) : undefined;
  };

  let revealFrame: number | undefined;
  const revealHighlighted = (block: ScrollLogicalPosition) => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    revealFrame = requestAnimationFrame(() => {
      revealFrame = undefined;
      revealTimeOption(list, block === 'center');
    });
  };
  onCleanup(() => {
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
  });

  const openList = () => {
    if (props.disabled || model.isOpen()) return;
    model.beginTyping();
    revealHighlighted('center');
  };

  const moveHighlight = (step: 1 | -1) => {
    model.moveHighlight(step);
    revealHighlighted('nearest');
  };

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const text = event.currentTarget.value;
    const filled = model.input(text, event.inputType.startsWith('insert'));
    // The normalized clock can equal the previous render after typing a period suffix.
    // Repair the native value too, since Solid then has no changed value to write.
    if (props.splitMeridiem) event.currentTarget.value = display().time;
    if (model.highlighted()) revealHighlighted('center');
    if (filled) {
      const completed = props.splitMeridiem ? display().time : filled;
      input.setSelectionRange(
        Math.min(text.length, completed.length),
        completed.length
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!model.isOpen()) openList();
      else moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      model.commit();
    } else if (event.key === 'Escape') {
      if (!model.isOpen() && model.state.typed === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      model.reset();
      input.select();
    }
  };

  return (
    <Popover
      anchorRef={() => input}
      open={model.isOpen()}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) model.commit();
      }}
      placement="bottom-start"
      gutter={4}
      flip={false}
      slide
    >
      <span class="relative inline-flex shrink-0">
        <Input
          ref={input}
          id={props.id}
          type="text"
          autocomplete="off"
          spellcheck={false}
          role="combobox"
          aria-label={props.label}
          aria-autocomplete="both"
          aria-controls={listId}
          aria-expanded={model.isOpen()}
          aria-activedescendant={activeDescendant()}
          aria-invalid={props.invalid || undefined}
          aria-describedby={
            [
              props.describedBy,
              props.splitMeridiem && display().meridiem ? periodId : undefined,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          disabled={props.disabled}
          value={
            props.splitMeridiem
              ? display().time
              : (model.state.shown ??
                formatTimeValue(props.value, props.timeFormat) ??
                '')
          }
          placeholder="Time"
          size="sm"
          class={cn(
            'w-[4.75rem] shrink-0',
            props.splitMeridiem && 'h-7 pr-10 text-sm',
            props.class
          )}
          variant={props.splitMeridiem ? 'value' : undefined}
          onFocus={() => {
            openList();
            input.select();
          }}
          onMouseDown={() => {
            if (document.activeElement === input) openList();
          }}
          onInput={onInput}
          onBlur={model.commit}
          on:keydown={onKeyDown}
        />
        <Show when={props.splitMeridiem && display().meridiem}>
          <span
            id={periodId}
            class={cn(
              'pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-ink-muted',
              props.disabled && 'opacity-50'
            )}
          >
            {display().meridiem}
          </span>
        </Show>
      </span>

      <Show when={model.isOpen()}>
        <ScopedPortal scope="local">
          <Layer depth={4}>
            <Popover.Content
              as={Dropdown.ContentFrame}
              class="max-h-[min(16rem,var(--kb-popper-content-available-height))] min-w-36 overflow-y-auto"
              style={{ 'z-index': 'calc(var(--z-index-action-menu) + 1)' }}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                const target = event.detail.originalEvent.target;
                if (target instanceof Node && input.contains(target)) {
                  event.preventDefault();
                }
              }}
            >
              <Popover.Title class="sr-only">
                Choose {props.label}
              </Popover.Title>
              <Dropdown.GroupFrame
                ref={(element) => {
                  list = element;
                  onElementConnect(element, () =>
                    onCleanup(observeTimeOptionViewport(element))
                  );
                }}
                id={listId}
                role="listbox"
                aria-label={props.label}
              >
                <For each={options()}>
                  {(option) => (
                    <Dropdown.ItemFrame
                      id={optionDomId(option)}
                      role="option"
                      aria-selected={option.id === selectedId()}
                      data-highlighted={
                        option.id === model.state.highlightedId ? '' : undefined
                      }
                      // Keep focus in the field, so it stays the one place keys go.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => model.choose(option)}
                    >
                      <span>{option.label}</span>
                      <span class="flex shrink-0 items-center gap-2">
                        <Show when={option.detail}>
                          {(detail) => (
                            <span class="text-xs text-ink-extra-muted">
                              {detail()}
                            </span>
                          )}
                        </Show>
                        <Show when={option.id === selectedId()}>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Show>
                      </span>
                    </Dropdown.ItemFrame>
                  )}
                </For>
              </Dropdown.GroupFrame>
            </Popover.Content>
          </Layer>
        </ScopedPortal>
      </Show>
    </Popover>
  );
}
