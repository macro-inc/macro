import { Popover } from '@kobalte/core/popover';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import CheckIcon from '@phosphor/check.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import {
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { DatabaseRelationSource } from '../context/relation-source';
import { relatedRowIds } from '../core/database-relations';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import type { GridCellEditorOptions } from '../core/grid-cell-editor';
import { focusAdjacent } from './cell-focus';

export type DatabaseRelationCellProps = GridCellEditorOptions & {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
  canEdit: boolean;
  source: DatabaseRelationSource;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
  onOpen: (rowId: string) => void;
};

/** The projection stays a set of row identities; names are presentation only. */
export function DatabaseRelationCell(props: DatabaseRelationCellProps) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal<string[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal(false);
  const [loadError, setLoadError] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let pendingWrite: Promise<boolean> | undefined;
  const listId = createUniqueId();
  const editable = () => props.canEdit && props.column.writable;
  const ids = () => relatedRowIds(props.value);
  const name = (id: string) =>
    props.source.rows().find((row) => row.id === id)?.name ??
    (props.source.loading() ? 'Loading…' : 'Unavailable record');
  const candidates = () =>
    props.source
      .rows()
      .filter((row) =>
        row.name
          .toLocaleLowerCase()
          .includes(search().trim().toLocaleLowerCase())
      );
  const active = () =>
    candidates()[Math.min(activeIndex(), Math.max(0, candidates().length - 1))];
  function begin(seed = '') {
    if (!saving() && !saveError()) setSelected(ids());
    setSearch(seed.replace(/^@/, ''));
    setActiveIndex(0);
    setOpen(true);
  }
  function close(restore = true, direction?: 1 | -1) {
    setOpen(false);
    if (direction && props.onNavigate?.(direction)) return;
    if (direction) {
      queueMicrotask(() => focusAdjacent(trigger, direction));
      return;
    }
    if (restore) queueMicrotask(() => trigger?.focus());
  }
  async function write(next: string[]) {
    if (!editable()) return false;
    setSelected(next);
    setSaving(true);
    setSaveError(false);
    const previous = pendingWrite;
    const save = (async () => {
      // Preserve rapid selections in order, including the latest complete set.
      // Stop on failure so a later selection cannot mask a rejected write.
      if (previous && !(await previous)) return false;
      if (!editable()) return false;
      try {
        return await props.onWrite(next.length ? JSON.stringify(next) : null);
      } catch {
        return false;
      }
    })();
    pendingWrite = save;
    try {
      const saved = await save;
      if (pendingWrite === save) setSaveError(!saved);
      return saved;
    } finally {
      if (pendingWrite === save) {
        pendingWrite = undefined;
        setSaving(false);
      }
    }
  }
  function toggle(id: string) {
    void write(
      selected().includes(id)
        ? selected().filter((value) => value !== id)
        : [...selected(), id]
    );
  }
  async function commitAndNavigate(direction: 1 | -1) {
    const row = active();
    if (editable() && search().trim() && row && !selected().includes(row.id)) {
      if (!(await write([...selected(), row.id]))) return;
    }
    await finish(direction);
  }
  async function finish(direction?: 1 | -1) {
    while (pendingWrite) {
      if (!(await pendingWrite)) return;
    }
    if (saveError() && !(await write(selected()))) return;
    close(true, direction);
  }
  function openRecord(id: string) {
    close(false);
    props.onOpen(id);
  }
  async function refresh() {
    setLoadError(false);
    try {
      await props.source.refresh();
    } catch {
      setLoadError(true);
    }
  }
  onMount(() =>
    props.onReady?.({
      focus: () => trigger?.focus(),
      edit: (seed) => begin(seed),
    })
  );
  onCleanup(() => props.onReady?.(undefined));
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        if (!value) close(false);
      }}
      anchorRef={() => trigger}
      placement="bottom-start"
      gutter={4}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <button
        ref={trigger}
        type="button"
        class="flex min-h-9 w-full min-w-0 items-center gap-1 rounded px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
        aria-label={`${props.column.name}: ${ids().map(name).join(', ') || 'Empty'}. ${editable() ? 'Choose related records' : 'View related records'}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => begin()}
        onKeyDown={(event) => {
          if (
            event.isComposing ||
            event.keyCode === 229 ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return;
          if (
            event.key === 'Tab' &&
            props.onNavigate?.(event.shiftKey ? -1 : 1)
          ) {
            event.preventDefault();
            event.stopPropagation();
          } else if (
            event.key === 'Enter' ||
            event.key === 'F2' ||
            event.key.length === 1
          ) {
            event.preventDefault();
            event.stopPropagation();
            begin(event.key.length === 1 ? event.key : '');
          } else if (
            editable() &&
            (event.key === 'Delete' || event.key === 'Backspace')
          ) {
            event.preventDefault();
            event.stopPropagation();
            void write([]);
          }
        }}
      >
        <Show
          when={ids().length}
          fallback={<span class="text-ink-placeholder opacity-40">—</span>}
        >
          <span class="flex min-w-0 items-center gap-1 overflow-hidden">
            <For each={ids().slice(0, 2)}>
              {(id) => (
                <span
                  class="inline-flex min-w-0 max-w-44 items-center gap-1 rounded border border-edge-muted/60 bg-hover/60 px-1.5 py-0.5 text-xs text-ink"
                  title={name(id)}
                >
                  <LinkIcon class="size-3 shrink-0 text-ink-muted" />
                  <span class="truncate">{name(id)}</span>
                </span>
              )}
            </For>
            <Show when={ids().length > 2}>
              <span class="shrink-0 text-xs text-ink-muted">
                +{ids().length - 2}
              </span>
            </Show>
          </span>
        </Show>
      </button>
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu flex w-80 max-w-[calc(100vw-1.5rem)] min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-menu text-ink shadow-menu outline-none"
          style={{
            'max-height':
              'min(30rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)))',
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input?.focus();
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <Popover.Title class="sr-only">
            {props.column.name} · {props.source.name()}
          </Popover.Title>
          <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
            <SearchIcon class="size-4 shrink-0 text-ink-muted" />
            <input
              ref={input}
              role="combobox"
              aria-label={`Search ${props.source.name()}`}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                active() ? `${listId}-${active()!.id}` : undefined
              }
              placeholder={`Search ${props.source.name()}…`}
              value={search()}
              class="h-7 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
              onInput={(event) => {
                setSearch(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.isComposing || event.keyCode === 229) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const count = candidates().length;
                  if (count) {
                    setActiveIndex(
                      (index) =>
                        (index + (event.key === 'ArrowDown' ? 1 : -1) + count) %
                        count
                    );
                    list
                      ?.querySelector<HTMLElement>(
                        `[data-relation-index="${activeIndex()}"]`
                      )
                      ?.scrollIntoView({ block: 'nearest' });
                  }
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const row = active();
                  if (row) {
                    if (editable()) toggle(row.id);
                    else openRecord(row.id);
                  }
                } else if (event.key === 'Tab') {
                  event.preventDefault();
                  void commitAndNavigate(event.shiftKey ? -1 : 1);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                }
              }}
            />
          </div>
          <div class="min-h-0 overflow-y-auto overscroll-contain">
            <Show when={selected().length}>
              <div class="flex flex-wrap gap-1.5 border-b border-edge-muted p-2">
                <For each={selected()}>
                  {(id) => (
                    <span class="inline-flex min-w-0 max-w-full items-center rounded border border-edge-muted bg-hover/60">
                      <button
                        type="button"
                        class="flex min-w-0 items-center gap-1 px-2 py-1 text-xs hover:bg-hover"
                        disabled={
                          !props.source.rows().some((row) => row.id === id)
                        }
                        title={`Open ${name(id)}`}
                        onClick={() => openRecord(id)}
                      >
                        <span class="truncate">{name(id)}</span>
                        <ArrowUpRightIcon class="size-3 shrink-0 text-ink-muted" />
                      </button>
                      <Show when={editable()}>
                        <button
                          type="button"
                          aria-label={`Remove ${name(id)}`}
                          class="rounded-r p-1 text-ink-muted hover:bg-hover"
                          onClick={() => toggle(id)}
                        >
                          <XIcon class="size-3" />
                        </button>
                      </Show>
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={props.source.name()}
              aria-multiselectable="true"
              class="p-1"
            >
              <For each={candidates()}>
                {(row, index) => (
                  <button
                    type="button"
                    role="option"
                    tabIndex={-1}
                    id={`${listId}-${row.id}`}
                    data-relation-index={index()}
                    aria-selected={selected().includes(row.id)}
                    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none"
                    classList={{ 'bg-hover': active()?.id === row.id }}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActiveIndex(index())}
                    onClick={() =>
                      editable() ? toggle(row.id) : openRecord(row.id)
                    }
                  >
                    <LinkIcon class="size-4 shrink-0 text-ink-muted" />
                    <span class="min-w-0 flex-1 truncate">{row.name}</span>
                    <Show when={selected().includes(row.id)}>
                      <CheckIcon class="size-3.5 text-ink-muted" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <Show when={!candidates().length && !props.source.error()}>
              <p
                role="status"
                class="px-3 py-4 text-center text-xs text-ink-muted"
              >
                {props.source.loading()
                  ? 'Loading…'
                  : search().trim()
                    ? 'No matches'
                    : 'No records yet'}
              </p>
            </Show>
            <Show when={props.source.error() || loadError()}>
              <div class="px-3 py-3 text-xs text-ink-muted">
                <p role="alert">
                  {props.source.error() ||
                    'Related records could not be loaded.'}
                </p>
                <button
                  type="button"
                  class="mt-1 rounded px-2 py-1 text-ink hover:bg-hover"
                  onClick={() => void refresh()}
                >
                  Retry
                </button>
              </div>
            </Show>
            <Show when={saveError()}>
              <p role="alert" class="px-3 py-2 text-xs text-failure-ink">
                This link could not be saved. Your selection is kept.
              </p>
            </Show>
          </div>
          <div class="flex shrink-0 items-center justify-between gap-2 border-t border-edge-muted px-3 py-2 text-xs text-ink-muted">
            <span class="truncate">
              {saving() ? 'Saving…' : props.source.name()}
            </span>
            <button
              type="button"
              class="rounded px-2 py-1 text-ink hover:bg-hover"
              onClick={() => void finish()}
            >
              {saveError() ? 'Retry' : 'Done'}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
