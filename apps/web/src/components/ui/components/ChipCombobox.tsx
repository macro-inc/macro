import XIcon from '@icon/system/regular/x.svg';
import { Combobox, useComboboxContext } from '@kobalte/core/combobox';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

/** A suggestion a ChipCombobox offers. */
export type ChipComboboxOption = {
  /** The stored value; chips show it. */
  value: string;
  /** What the suggestion row shows, e.g. a company name. */
  label: string;
  /** Muted text beside the label, e.g. a domain or a count. */
  detail?: string;
};

export type ChipComboboxProps = {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Suggestions, best first; the field filters them by what is typed. */
  options: readonly ChipComboboxOption[];
  /** Turns typed text into a value, or `undefined` when it isn't one. Omit to allow only suggestions. */
  parseValue?: (text: string) => string | undefined;
  /** The row that adds typed text, e.g. `Add “acme.com”`. */
  addLabel: (value: string) => string;
  /** Accessible name of a chip's remove button. */
  removeLabel: (value: string) => string;
  'aria-label': string;
  placeholder?: string;
  /** Mount suggestions inside the nearest `.portal-scope`, as dialogs and drawers need. */
  portalScope?: 'local';
  /** Most suggestions shown at once. */
  maxOptions?: number;
  disabled?: boolean;
  class?: string;
};

type Item = {
  key: string;
  value: string;
  label: string;
  detail?: string;
};

const SEPARATORS = /[,;\n]/;
const DEFAULT_MAX_OPTIONS = 8;

function Chip(props: {
  value: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span class="flex max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full bg-active py-1 pr-1 pl-2.5">
      <span class="min-w-0 truncate text-sm">{props.value}</span>
      <button
        type="button"
        aria-label={props.removeLabel}
        class="rounded-full p-1 text-ink-muted not-touch:hover:bg-hover not-touch:hover:text-failure"
        // Keep focus in the field so the next entry can be typed straight away.
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onRemove}
      >
        <XIcon class="size-3" />
      </button>
    </span>
  );
}

/**
 * A multi-value field of chips with suggestions and, given `parseValue`,
 * typed entries. A separator (`,` `;` or a newline) or leaving the field
 * commits what was typed. Enter adds typed text that is a value unless an
 * arrow key picked a row, otherwise the top suggestion; it never submits a
 * surrounding form. Backspace in an empty field removes the last chip.
 *
 * @do Use for lists of short values chosen from suggestions or typed, such as domains.
 * @dont Do not use for people; RecipientSelector knows users, contacts, and channels.
 */
export function ChipCombobox(props: ChipComboboxProps): JSX.Element {
  const [text, setText] = createSignal('');
  const [open, setOpen] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let content: HTMLElement | undefined;
  let mountProbe: HTMLDivElement | undefined;
  // Kobalte owns the input text; clearing it goes through its setter.
  let setKobalteInput: ((value: string) => void) | undefined;
  // Suggestions reorder as they load; Enter keeps what was typed unless an
  // arrow key chose a row since the last edit.
  let rowPickedByKey = false;

  const chosen = createMemo(() => new Set(props.values));
  const labels = createMemo(
    () => new Map(props.options.map((option) => [option.value, option.label]))
  );
  const selected = createMemo((): Item[] =>
    props.values.map((value) => ({
      key: value,
      value,
      label: labels().get(value) ?? value,
    }))
  );
  const typed = () => {
    const raw = text().trim();
    return raw ? props.parseValue?.(raw) : undefined;
  };
  const suggestions = createMemo((): Item[] => {
    const query = text().trim().toLowerCase();
    return props.options
      .filter(
        (option) =>
          !chosen().has(option.value) &&
          (!query ||
            [option.value, option.label, option.detail ?? ''].some((part) =>
              part.toLowerCase().includes(query)
            ))
      )
      .slice(0, props.maxOptions ?? DEFAULT_MAX_OPTIONS)
      .map((option) => ({ key: option.value, ...option }));
  });
  const addRow = createMemo((): Item | undefined => {
    const value = typed();
    if (!value || chosen().has(value)) return undefined;
    if (suggestions().some((item) => item.value === value)) return undefined;
    return { key: `add:${value}`, value, label: props.addLabel(value) };
  });
  // Kobalte draws chips from selected items, so they stay among the options.
  const items = createMemo(() => {
    const add = addRow();
    return [...selected(), ...suggestions(), ...(add ? [add] : [])];
  });
  const listed = () => suggestions().length > 0 || addRow() !== undefined;

  const commit = (values: readonly string[]) => {
    const next = [...new Set([...props.values, ...values])];
    if (next.length !== props.values.length) props.onChange(next);
  };
  const setInputText = (next: string) => {
    setText(next);
    setKobalteInput?.(next);
  };
  /** Commits typed text; `false` when it isn't a value. */
  const commitTyped = () => {
    const value = typed();
    if (!value) return false;
    commit([value]);
    setInputText('');
    return true;
  };

  const onInputChange = (next: string) => {
    rowPickedByKey = false;
    if (props.parseValue && SEPARATORS.test(next)) {
      const parts = next.split(SEPARATORS);
      const rest = (parts.pop() ?? '').trimStart();
      commit(
        parts.flatMap((part) => {
          const value = part.trim() ? props.parseValue?.(part) : undefined;
          return value ? [value] : [];
        })
      );
      setInputText(rest);
    } else {
      setText(next);
    }
    setOpen(listed());
  };

  const onEnter = (event: KeyboardEvent) => {
    // Enter ends an entry here; it never submits a surrounding form.
    event.preventDefault();
    if (rowPickedByKey && open()) return;
    // Kobalte would pick a highlighted row too.
    event.stopPropagation();
    if (commitTyped()) return;
    const top = suggestions()[0];
    if (!top) return;
    commit([top.value]);
    setInputText('');
  };

  const portalMount = () =>
    props.portalScope === 'local'
      ? (mountProbe?.closest<HTMLElement>('.portal-scope') ?? undefined)
      : undefined;

  return (
    <Layer depth={2}>
      <Combobox<Item>
        multiple
        options={items()}
        optionValue="key"
        optionTextValue="label"
        optionLabel="label"
        // `suggestions` already filtered by the text; chips stay out of the list.
        defaultFilter={(item) => !chosen().has(item.key)}
        value={selected()}
        onChange={(next) => {
          props.onChange([...new Set(next.map((item) => item.value))]);
          setInputText('');
        }}
        onInputChange={onInputChange}
        open={open() && listed()}
        onOpenChange={(next) => setOpen(next && listed())}
        triggerMode="focus"
        closeOnSelection={false}
        // Leaving commits a typed value; text that isn't one stays to fix.
        noResetInputOnBlur
        shouldFocusWrap
        disabled={props.disabled}
        placeholder={props.values.length ? undefined : props.placeholder}
        class={cn(
          'w-full rounded-2xl border border-edge-muted bg-input p-2 text-base focus-within:ring-2 focus-within:ring-edge-muted',
          props.class
        )}
        itemComponent={(itemProps) => (
          <Combobox.Item
            item={itemProps.item}
            class="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-ink outline-none data-highlighted:bg-hover touch:min-h-11"
          >
            <Combobox.ItemLabel class="min-w-0 flex-1 truncate">
              {itemProps.item.rawValue.label}
            </Combobox.ItemLabel>
            <Show when={itemProps.item.rawValue.detail}>
              {(detail) => (
                <span class="shrink-0 text-xs text-ink-muted">{detail()}</span>
              )}
            </Show>
          </Combobox.Item>
        )}
      >
        <Combobox.Control<Item> class="flex flex-wrap items-center gap-1.5">
          {(state) => {
            setKobalteInput = useComboboxContext().setInputValue;
            return (
              <>
                <For each={state.selectedOptions()}>
                  {(item) => (
                    <Chip
                      value={item.value}
                      removeLabel={props.removeLabel(item.value)}
                      onRemove={() => state.remove(item)}
                    />
                  )}
                </For>
                <Combobox.Input
                  ref={(el: HTMLInputElement) => {
                    input = el;
                  }}
                  aria-label={props['aria-label']}
                  class="min-h-7 min-w-32 flex-1 bg-transparent p-1 text-ink outline-none placeholder:text-ink-placeholder"
                  // Native, so it runs before Kobalte's delegated handler.
                  on:keydown={(event: KeyboardEvent) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                      rowPickedByKey = true;
                    if (event.key === 'Enter' && !event.isComposing)
                      onEnter(event);
                  }}
                  onBlur={(event: FocusEvent) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof Node && content?.contains(next)))
                      commitTyped();
                  }}
                />
              </>
            );
          }}
        </Combobox.Control>
        <div class="hidden" ref={mountProbe} />
        <Combobox.Portal mount={portalMount()}>
          <Combobox.Content
            ref={(el: HTMLElement) => {
              content = el;
            }}
            // As in RecipientSelector: WebKit moves tap focus to the nearest
            // focusable ancestor, so the list takes it and hands it back;
            // presses keep focus in the field and never start a drawer drag.
            tabIndex={-1}
            on:focusin={(event: FocusEvent) => {
              if (event.target === event.currentTarget)
                input?.focus({ preventScroll: true });
            }}
            onPointerDown={(event: PointerEvent) => event.preventDefault()}
            data-corvu-no-drag=""
            onFocusOutside={(event) => {
              const focused = event.detail.originalEvent.target;
              if (
                content &&
                focused instanceof Node &&
                focused.contains(content)
              ) {
                event.preventDefault();
                input?.focus({ preventScroll: true });
              }
            }}
            class="menu-surface z-modal-content translate-y-1 p-1.5 menu-open-animation"
          >
            <Combobox.Listbox class="flex max-h-64 flex-col gap-0.5 overflow-y-auto" />
          </Combobox.Content>
        </Combobox.Portal>
      </Combobox>
    </Layer>
  );
}
