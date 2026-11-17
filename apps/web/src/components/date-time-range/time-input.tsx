import { ScopedPortal } from '@core/component/ScopedPortal';
import CheckIcon from '@icon/system/regular/check.svg';
import { Popover } from '@kobalte/core/popover';
import { Dropdown } from '@ui/components/Dropdown';
import { Input } from '@ui/components/Input';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createMemo, createUniqueId, For, Show } from 'solid-js';
import type { ClockFormat } from './primitives/clock-format';
import { createTimeInput } from './primitives/create-time-input';
import {
  dayTimeOptions,
  formatTimeValue,
  selectedTimeOptionId,
  type TimeOption,
} from './time-options';
import { TimeValue } from './time-value/TimeValue';

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
  /** Separate the resting clock value and meridiem without changing native typing. */
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
    onChange: (option) => props.onChange(option),
  });
  const optionDomId = (option: TimeOption) =>
    `${listId}-${option.id.replace('|', '-')}`;
  const activeDescendant = () => {
    const option = model.isOpen() ? model.highlighted() : undefined;
    return option ? optionDomId(option) : undefined;
  };

  const revealHighlighted = (block: ScrollLogicalPosition) => {
    requestAnimationFrame(() => {
      list
        ?.querySelector<HTMLElement>('[data-highlighted]')
        ?.scrollIntoView({ block });
    });
  };

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
    if (model.highlighted()) revealHighlighted('center');
    if (filled) input.setSelectionRange(text.length, filled.length);
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
      flip
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
          aria-describedby={props.describedBy}
          disabled={props.disabled}
          value={
            model.state.shown ??
            formatTimeValue(props.value, props.timeFormat) ??
            ''
          }
          placeholder="Time"
          size="sm"
          class={cn(
            'w-[4.75rem] shrink-0',
            props.splitMeridiem && 'h-7 text-sm',
            props.splitMeridiem && !model.isOpen() && 'text-transparent',
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
        <Show when={props.splitMeridiem && !model.isOpen()}>
          <span
            aria-hidden="true"
            class={cn(
              'pointer-events-none absolute inset-0 flex items-center px-2.5 text-sm',
              props.disabled && 'opacity-50'
            )}
          >
            <TimeValue value={props.value} timeFormat={props.timeFormat} />
          </span>
        </Show>
      </span>

      <ScopedPortal scope="local">
        <Layer depth={4}>
          <Popover.Content
            as={Dropdown.ContentFrame}
            class="max-h-64 min-w-36 overflow-y-auto"
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
            <Popover.Title class="sr-only">Choose {props.label}</Popover.Title>
            <Dropdown.GroupFrame
              ref={list}
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
    </Popover>
  );
}
