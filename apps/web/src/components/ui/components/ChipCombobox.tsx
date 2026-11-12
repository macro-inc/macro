import { isTouchDevice } from '@core/mobile/isTouchDevice';
import XIcon from '@icon/system/regular/x.svg';
import { Combobox, useComboboxContext } from '@kobalte/core/combobox';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

/** How a value reads on its suggestion row and chip. */
export type ChipComboboxDisplay = {
  /** What the suggestion row shows, e.g. a company or person's name. */
  label: string;
  /** Muted text beside the label, e.g. a domain, an address, or a count. */
  detail?: string;
  /** What the chip shows; defaults to the label. */
  chipLabel?: string;
  /** Drawn before the label on its row and chip. */
  icon?: () => JSX.Element;
};

/** A suggestion a ChipCombobox offers; search matches its label and detail. */
export type ChipComboboxOption = ChipComboboxDisplay & {
  /** The stored value, unique among options. */
  value: string;
};

export type ChipComboboxProps = {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** Suggestions, best first; the field filters them by what is typed. */
  options: readonly ChipComboboxOption[];
  /** How a value no option describes reads, such as a typed one. Defaults to the value itself. */
  describeValue?: (value: string) => ChipComboboxDisplay;
  /** Turns typed text into a value, or `undefined` when it isn't one. Omit to allow only suggestions. */
  parseValue?: (text: string) => string | undefined;
  /** The row that adds typed text, e.g. `Add “acme.com”`. */
  addLabel: (value: string) => string;
  /** Accessible name of a chip's remove button, from what the chip shows. */
  removeLabel: (chipLabel: string) => string;
  'aria-label': string;
  placeholder?: string;
  /** Mount suggestions inside the nearest `.portal-scope`, as dialogs and drawers need. */
  portalScope?: 'local';
  /** Most suggestions shown at once. */
  maxOptions?: number;
  disabled?: boolean;
  class?: string;
};

type Item = ChipComboboxOption & { key: string };

const SEPARATORS = /[,;\n]/;
const DEFAULT_MAX_OPTIONS = 8;

function Chip(props: {
  item: Item;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span class="flex h-6 max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full bg-active pr-0.5 pl-1.5">
      <Show when={props.item.icon}>{(icon) => icon()()}</Show>
      <span class="min-w-0 truncate px-0.5 text-sm">
        {props.item.chipLabel ?? props.item.label}
      </span>
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
 * @do Use for lists of short values chosen from suggestions or typed, such as
 *   domains, or people and companies together; give each option an icon.
 * @dont Do not use for message recipients; RecipientSelector knows users, contacts, and channels.
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
  const known = createMemo(
    () => new Map(props.options.map((option) => [option.value, option]))
  );
  const describe = (value: string): Item => ({
    ...(known().get(value) ?? props.describeValue?.(value) ?? { label: value }),
    key: value,
    value,
  });
  const selected = createMemo((): Item[] => props.values.map(describe));
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
            [option.label, option.detail ?? ''].some((part) =>
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
    return {
      ...describe(value),
      key: `add:${value}`,
      label: props.addLabel(value),
      detail: undefined,
    };
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
        // The outline Input's frame; it grows from a pill as chips wrap.
        class={cn(
          'flex min-h-8 w-full items-center border border-edge-frame bg-control px-0.5 py-px text-base text-ink transition-[border-color,box-shadow] duration-120 focus-within:ring-2 focus-within:ring-edge-muted not-touch:elevated motion-reduce:transition-none',
          isTouchDevice() ? 'rounded-lg' : 'rounded-2xl',
          props.class
        )}
        itemComponent={(itemProps) => (
          <Combobox.Item
            item={itemProps.item}
            class="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-ink outline-none data-highlighted:bg-hover touch:min-h-11"
          >
            <Show when={itemProps.item.rawValue.icon}>
              {(icon) => icon()()}
            </Show>
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
        <Combobox.Control<Item> class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {(state) => {
            setKobalteInput = useComboboxContext().setInputValue;
            return (
              <>
                <For each={state.selectedOptions()}>
                  {(item) => (
                    <Chip
                      item={item}
                      removeLabel={props.removeLabel(
                        item.chipLabel ?? item.label
                      )}
                      onRemove={() => state.remove(item)}
                    />
                  )}
                </For>
                <Combobox.Input
                  ref={(el: HTMLInputElement) => {
                    input = el;
                  }}
                  aria-label={props['aria-label']}
                  class="h-7 min-w-32 flex-1 bg-transparent px-2.5 text-ink outline-none placeholder:text-ink-placeholder"
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
