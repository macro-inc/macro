/**
 * The font family picker of the Type section, as Figma's: a search over
 * the document's fonts and Google Fonts, each family previewed in its own
 * face once scrolled into view. Presentational: previews come from
 * `preview`, which resolves to a CSS family to draw the name in.
 */

import { Popover } from '@kobalte/core/popover';
import CaretDown from '@phosphor/caret-down.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import { Layer } from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

/** Rows shown at most; typing narrows the rest. */
const LIMIT = 150;

function Row(props: {
  id: string;
  family: string;
  selected: boolean;
  active: boolean;
  onActive: () => void;
  preview?: (family: string) => Promise<string | undefined>;
  onSelect: () => void;
}) {
  const [face, setFace] = createSignal<string>();
  let el!: HTMLButtonElement;
  onMount(() => {
    if (!props.preview) return;
    const preview = props.preview;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        try {
          setFace(await preview(props.family));
        } catch {
          // No preview: the name shows in the panel's font.
        }
      })();
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  return (
    <button
      ref={el}
      type="button"
      id={props.id}
      tabIndex={-1}
      role="option"
      aria-selected={props.selected}
      data-active={props.active ? 'true' : undefined}
      data-testid="fig-font-option"
      data-family={props.family}
      class="w-full truncate rounded px-2 py-1.5 text-left text-ink hover:bg-hover aria-selected:font-medium data-[active=true]:bg-hover"
      style={{
        'font-family': face() ? `"${face()}", Inter, sans-serif` : undefined,
      }}
      onClick={() => props.onSelect()}
      onPointerMove={props.onActive}
    >
      {props.family}
    </button>
  );
}

export function FontPicker(props: {
  /** The family shown; `null` when the selection mixes families. */
  value: string | null;
  /** The document's families, listed first. */
  documentFamilies: readonly string[];
  /** Google Fonts families, most popular first. */
  googleFamilies: readonly string[];
  /** The family is missing (shown with a warning). */
  missing?: boolean;
  preview?: (family: string) => Promise<string | undefined>;
  onOpen?: () => void;
  onSelect: (family: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal<string>();
  const listId = createUniqueId();
  let list!: HTMLDivElement;
  const matches = (family: string) =>
    family.toLowerCase().includes(query().trim().toLowerCase());
  const documentRows = createMemo(() => props.documentFamilies.filter(matches));
  const googleRows = createMemo(() => {
    const shown = new Set(props.documentFamilies);
    const out: string[] = [];
    for (const f of props.googleFamilies) {
      if (out.length >= LIMIT) break;
      if (!shown.has(f) && matches(f)) out.push(f);
    }
    return out;
  });
  const choose = (family: string) => {
    setOpen(false);
    setQuery('');
    props.onSelect(family);
  };
  const rows = () => [...documentRows(), ...googleRows()];
  const rowId = (family: string) => `${listId}-${encodeURIComponent(family)}`;
  const navigate = (event: KeyboardEvent) => {
    const families = rows();
    if (families.length === 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active() ?? families[0]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const current = families.indexOf(active() ?? '');
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next =
        current < 0
          ? direction > 0
            ? 0
            : families.length - 1
          : (current + direction + families.length) % families.length;
      setActive(families[next]);
      list
        .querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  };
  return (
    <Popover
      placement="left-start"
      gutter={40}
      open={open()}
      onOpenChange={(o) => {
        setOpen(o);
        setActive(undefined);
        if (o) props.onOpen?.();
      }}
    >
      <Popover.Trigger
        class="flex min-w-0 items-center gap-1.5 rounded-md bg-inset px-2 py-1 text-left text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
        aria-label="Font family"
        data-testid="fig-font-family"
        data-value={props.value ?? 'Mixed'}
      >
        <Show when={props.missing}>
          <span title="This font is missing; text shows in Inter">
            <WarningCircle
              class="size-3.5 shrink-0 text-warning"
              data-testid="fig-font-missing"
            />
          </span>
        </Show>
        <span class="min-w-0 flex-1 truncate">{props.value ?? 'Mixed'}</span>
        <CaretDown class="size-3 shrink-0 text-ink-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="fig-editor-theme z-modal flex max-h-96 w-64 flex-col rounded-xl border border-edge-muted bg-menu p-2 text-xs shadow-xl outline-none"
            aria-label="Fonts"
            data-testid="fig-font-picker"
            onKeyDown={(e: KeyboardEvent) => {
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            <input
              class="mb-1.5 rounded-md bg-inset px-2 py-1 text-ink outline-none placeholder:text-ink-placeholder focus:outline focus:outline-1 focus:outline-accent"
              placeholder="Search fonts"
              aria-label="Search fonts"
              data-testid="fig-font-search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open()}
              aria-controls={listId}
              aria-activedescendant={active() ? rowId(active()!) : undefined}
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setActive(undefined);
              }}
              onKeyDown={navigate}
              autofocus
            />
            <div
              ref={list}
              id={listId}
              class="min-h-0 flex-1 overflow-y-auto"
              role="listbox"
              aria-label="Font families"
            >
              <Show when={documentRows().length > 0}>
                <div class="px-2 pt-1 pb-0.5 text-ink-muted text-xs">
                  In this file
                </div>
                <For each={documentRows()}>
                  {(f) => (
                    <Row
                      id={rowId(f)}
                      family={f}
                      selected={f === props.value}
                      active={f === active()}
                      onActive={() => setActive(f)}
                      preview={props.preview}
                      onSelect={() => choose(f)}
                    />
                  )}
                </For>
              </Show>
              <Show when={googleRows().length > 0}>
                <div class="px-2 pt-2 pb-0.5 text-ink-muted text-xs">
                  Google Fonts
                </div>
                <For each={googleRows()}>
                  {(f) => (
                    <Row
                      id={rowId(f)}
                      family={f}
                      selected={f === props.value}
                      active={f === active()}
                      onActive={() => setActive(f)}
                      preview={props.preview}
                      onSelect={() => choose(f)}
                    />
                  )}
                </For>
              </Show>
              <Show
                when={documentRows().length === 0 && googleRows().length === 0}
              >
                <div class="px-2 py-3 text-center text-ink-muted">
                  No fonts match
                </div>
              </Show>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
