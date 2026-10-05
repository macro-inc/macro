/**
 * Font family and size pickers: type a value or choose from the list, the
 * way PowerPoint's font boxes work.
 */

import { Popover } from '@kobalte/core/popover';
import CaretDown from '@phosphor/caret-down.svg';
import { createMemo, createSignal, For, Show } from 'solid-js';

/** Fonts every deck can use; the engine substitutes metric-compatible faces. */
export const COMMON_FONTS = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Book Antiqua',
  'Calibri',
  'Calibri Light',
  'Cambria',
  'Candara',
  'Century Gothic',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Book',
  'Garamond',
  'Georgia',
  'Gill Sans MT',
  'Helvetica',
  'Lucida Console',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

export const FONT_SIZES = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60,
  66, 72, 80, 88, 96,
];

function Combo(props: {
  label: string;
  value: string;
  width: string;
  disabled?: boolean;
  testId?: string;
  /** Commits typed text; returns false to restore the shown value. */
  onCommit: (text: string) => void;
  list: (close: () => void, filter: string) => import('solid-js').JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal('');
  let input!: HTMLInputElement;
  const commit = () => {
    const text = input.value.trim();
    if (text && text !== props.value) props.onCommit(text);
    else input.value = props.value;
  };
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={2}
    >
      <Popover.Anchor
        class="flex h-7 items-center rounded-md border border-edge-muted bg-input focus-within:border-accent"
        classList={{ 'opacity-50': props.disabled }}
      >
        <input
          ref={input}
          data-testid={props.testId}
          aria-label={props.label}
          title={props.label}
          disabled={props.disabled}
          class="min-w-0 bg-transparent px-1.5 text-ink text-xs outline-none"
          style={{ width: props.width }}
          value={props.value}
          onFocus={(e) => e.currentTarget.select()}
          onInput={(e) => {
            setFilter(e.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              setOpen(false);
              commit();
            } else if (e.key === 'Escape') {
              input.value = props.value;
              setOpen(false);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setFilter('');
              setOpen(true);
            }
          }}
          onBlur={(e) => {
            // A click into the list commits through the list instead.
            const next = e.relatedTarget as Node | null;
            if (
              next &&
              document.getElementById(`${props.label}-list`)?.contains(next)
            )
              return;
            commit();
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${props.label} list`}
          disabled={props.disabled}
          class="flex h-full items-center px-0.5 text-ink-muted hover:text-ink"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFilter('');
            setOpen((o) => !o);
          }}
        >
          <CaretDown class="size-2.5" />
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={`${props.label}-list`}
          class="z-action-menu max-h-80 overflow-y-auto rounded-xl border border-edge bg-menu p-1 text-ink shadow-xl outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {props.list(() => setOpen(false), filter())}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** Font family box. `themeFonts` are the deck's heading and body fonts. */
export function FontPicker(props: {
  value?: string;
  themeFonts?: { major: string; minor: string };
  recent?: string[];
  disabled?: boolean;
  onPick: (font: string) => void;
}) {
  const shown = () => {
    const v = props.value ?? '';
    if (v === '+mj-lt') return props.themeFonts?.major ?? 'Headings';
    if (v === '+mn-lt') return props.themeFonts?.minor ?? 'Body';
    return v;
  };
  const item = (font: string, label: string, close: () => void) => (
    <button
      type="button"
      class="flex w-full items-center justify-between gap-4 rounded-md px-2 py-1 text-left text-sm hover:bg-ink/5"
      classList={{ 'bg-accent-bg text-accent': font === props.value }}
      style={{ 'font-family': `"${label}", sans-serif` }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        close();
        props.onPick(font);
      }}
    >
      <span>{label}</span>
    </button>
  );
  return (
    <Combo
      label="Font"
      testId="pptx-font-family"
      value={shown()}
      width="7.5rem"
      disabled={props.disabled}
      onCommit={props.onPick}
      list={(close, filter) => {
        const match = (f: string) =>
          !filter || f.toLowerCase().includes(filter.toLowerCase());
        const common = COMMON_FONTS.filter(match);
        return (
          <div class="w-60">
            <Show when={props.themeFonts && !filter}>
              <div class="px-2 pt-1 pb-0.5 text-ink-muted text-xs">
                Theme fonts
              </div>
              {item('+mj-lt', props.themeFonts!.major, close)}
              {item('+mn-lt', props.themeFonts!.minor, close)}
            </Show>
            <Show when={(props.recent ?? []).filter(match).length > 0}>
              <div class="px-2 pt-1 pb-0.5 text-ink-muted text-xs">
                Recently used
              </div>
              <For each={(props.recent ?? []).filter(match)}>
                {(f) => item(f, f, close)}
              </For>
            </Show>
            <div class="px-2 pt-1 pb-0.5 text-ink-muted text-xs">All fonts</div>
            <For each={common}>{(f) => item(f, f, close)}</For>
          </div>
        );
      }}
    />
  );
}

/** Font size box: type any size or pick a standard one. */
export function FontSizePicker(props: {
  value?: number;
  disabled?: boolean;
  onPick: (size: number) => void;
}) {
  const shown = createMemo(() =>
    props.value === undefined ? '' : String(Math.round(props.value * 10) / 10)
  );
  return (
    <Combo
      label="Font size"
      testId="pptx-font-size"
      value={shown()}
      width="2.25rem"
      disabled={props.disabled}
      onCommit={(text) => {
        const n = Number.parseFloat(text);
        if (Number.isFinite(n) && n >= 1 && n <= 4000)
          props.onPick(Math.round(n * 2) / 2);
      }}
      list={(close) => (
        <div class="w-16">
          <For each={FONT_SIZES}>
            {(size) => (
              <button
                type="button"
                class="w-full rounded-md px-2 py-0.5 text-left text-sm tabular-nums hover:bg-ink/5"
                classList={{ 'bg-accent-bg text-accent': size === props.value }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  close();
                  props.onPick(size);
                }}
              >
                {size}
              </button>
            )}
          </For>
        </div>
      )}
    />
  );
}
