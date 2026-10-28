import { ScopedPortal } from '@core/component/ScopedPortal';
import CheckIcon from '@icon/system/regular/check.svg';
import { Popover } from '@kobalte/core/popover';
import { Input } from '@ui/components/Input';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import {
  completedTypedTime,
  DAY_TIME_OPTIONS,
  formatTimeValue,
  matchTypedTime,
  selectedTimeOptionId,
  type TimeOption,
  typedTimeOption,
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
  /** Selectable times; defaults to every quarter-hour in a day. */
  options?: TimeOption[];
  /** Highlighted option; defaults to `value` on the anchor day. */
  selectedId?: string;
  onChange: (option: TimeOption) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  class?: string;
}

/**
 * A clock time typed or picked from a list, as Google Calendar's time fields
 * work: typing `3`, `3p`, `330` or `15:30` jumps the list to that time and
 * fills in the rest of its label; Enter, Tab or leaving the field commits,
 * Escape puts the old time back.
 */
export function TimeInput(props: TimeInputProps) {
  const listId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  /** What the user typed, while they are typing; the field shows the value otherwise. */
  const [typed, setTyped] = createSignal<string>();
  /** The field's text while typing: `typed` plus any filled-in label. */
  const [shown, setShown] = createSignal<string>();
  const [highlightedId, setHighlightedId] = createSignal<string>();
  /** Whether the arrow keys moved the highlight, making it the choice. */
  const [navigated, setNavigated] = createSignal(false);
  let input!: HTMLInputElement;
  let list: HTMLDivElement | undefined;

  const options = createMemo(() => props.options ?? DAY_TIME_OPTIONS);
  const selectedId = () =>
    props.selectedId ?? selectedTimeOptionId(props.value);
  const optionDomId = (option: TimeOption) =>
    `${listId}-${option.id.replace('|', '-')}`;
  const highlighted = () =>
    options().find((option) => option.id === highlightedId());
  const activeDescendant = () => {
    const option = open() ? highlighted() : undefined;
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
    if (props.disabled || open()) return;
    setHighlightedId(selectedId());
    setOpen(true);
    revealHighlighted('center');
  };

  const reset = () => {
    setTyped(undefined);
    setShown(undefined);
    setNavigated(false);
    setOpen(false);
  };

  const choose = (option: TimeOption | undefined) => {
    if (option && option.id !== selectedId()) props.onChange(option);
    reset();
  };

  /** Commits what the field holds: the time typed, or the one arrowed to. */
  const commit = () => {
    const text = typed();
    if (text !== undefined) {
      choose(highlighted() ?? typedTimeOption(options(), text));
    } else {
      choose(navigated() ? highlighted() : undefined);
    }
  };

  const moveHighlight = (step: 1 | -1) => {
    const all = options();
    const index = all.findIndex((option) => option.id === highlightedId());
    const next =
      index === -1
        ? step === 1
          ? 0
          : all.length - 1
        : (index + step + all.length) % all.length;
    const option = all[next];
    if (!option) return;
    setHighlightedId(option.id);
    setNavigated(true);
    setTyped(undefined);
    setShown(undefined);
    revealHighlighted('nearest');
  };

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const text = event.currentTarget.value;
    const match = matchTypedTime(options(), text);
    setTyped(text);
    setNavigated(false);
    setHighlightedId(match?.id);
    if (!open()) setOpen(true);
    if (match) revealHighlighted('center');

    const filled = event.inputType.startsWith('insert')
      ? completedTypedTime(text, match)
      : undefined;
    setShown(filled ?? text);
    if (filled) input.setSelectionRange(text.length, filled.length);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!open()) openList();
      else moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === 'Escape') {
      if (!open() && typed() === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      input.select();
    }
  };

  return (
    <Popover
      anchorRef={() => input}
      open={open() && !props.disabled}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) commit();
      }}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
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
        aria-expanded={open()}
        aria-activedescendant={activeDescendant()}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        disabled={props.disabled}
        value={shown() ?? formatTimeValue(props.value) ?? ''}
        placeholder="Time"
        size="sm"
        class={cn('w-[4.75rem] shrink-0', props.class)}
        onFocus={() => {
          openList();
          input.select();
        }}
        onMouseDown={() => {
          if (document.activeElement === input) openList();
        }}
        onInput={onInput}
        onBlur={commit}
        on:keydown={onKeyDown}
      />

      <ScopedPortal scope="local">
        <Layer depth={4}>
          <Popover.Content
            class="menu-surface z-action-menu max-h-64 min-w-36 overflow-y-auto p-1.5 menu-open-animation"
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
            <div ref={list} id={listId} role="listbox" aria-label={props.label}>
              <For each={options()}>
                {(option) => (
                  <div
                    id={optionDomId(option)}
                    role="option"
                    aria-selected={option.id === selectedId()}
                    data-highlighted={
                      option.id === highlightedId() ? '' : undefined
                    }
                    class="flex cursor-default items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-ink hover:bg-hover aria-selected:bg-active data-highlighted:bg-hover"
                    // Keep focus in the field, so it stays the one place keys go.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
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
                  </div>
                )}
              </For>
            </div>
          </Popover.Content>
        </Layer>
      </ScopedPortal>
    </Popover>
  );
}
