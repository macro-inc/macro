/**
 * The left panel: the file's pages and the current page's layer tree,
 * loaded lazily as rows expand, with search (⌘F).
 */

import { IS_MAC } from '@core/constant/isMac';
import type { FigEngine } from '@core/fig-engine/client';
import type { LayerRow, SearchHit } from '@core/fig-engine/types';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import LockSimple from '@phosphor/lock-simple.svg';
import LockSimpleOpen from '@phosphor/lock-simple-open.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { VList, type VListHandle } from 'virtua/solid';
import { isComponentType, LayerIcon } from '../components/layer-icon';
import { rowClick, treeMove } from '../core/layer-tree';
import { isPageDivider } from '../core/pages';
import { isCommitKey } from '../core/shortcuts';
import type { FigEditor } from '../primitives/create-fig-editor';
import type { FigViewer } from '../primitives/create-fig-viewer';

const ROOT = '';
const ROW_HEIGHT = 28;

interface FlatRow {
  row: LayerRow;
  depth: number;
  expanded: boolean;
  /** Inside a selected layer (Figma tints these rows). */
  inSelection: boolean;
  /** Parent layer id (the page's id for top-level rows). */
  parent: string;
  /** Index among its siblings in the engine's order (bottom first). */
  index: number;
}

/** Where a dragged row would land relative to the row under it. */
type DropZone = 'above' | 'below' | 'inside';

export function LayersPanel(props: {
  viewer: FigViewer;
  engine: FigEngine;
  /** Where ⌘F focuses. */
  searchRef?: (el: HTMLInputElement) => void;
  /** Renaming, visibility, locking, and reordering when editable. */
  editor?: FigEditor;
}) {
  const viewer = props.viewer;
  const [children, setChildren] = createSignal(new Map<string, LayerRow[]>());
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchHit[]>([]);
  const [pagesOpen, setPagesOpen] = createSignal(true);
  let list: VListHandle | undefined;
  const loading = new Set<string>();

  const load = async (parent: string) => {
    if (loading.has(parent) || children().has(parent)) return;
    loading.add(parent);
    const page = viewer.page();
    try {
      const rows = await props.engine.layers(page, parent || undefined);
      if (page !== viewer.page()) return;
      setChildren((m) => new Map(m).set(parent, rows));
    } finally {
      loading.delete(parent);
    }
  };

  // A new page starts with a fresh, collapsed tree.
  createEffect(
    on(viewer.page, () => {
      setChildren(new Map());
      setExpanded(new Set<string>());
      void load(ROOT);
    })
  );
  // After an edit, every loaded level reloads in place (expansion kept).
  createEffect(
    on(
      viewer.editVersion,
      async () => {
        const page = viewer.page();
        const parents = [...children().keys()];
        const fresh = await Promise.all(
          parents.map((p) =>
            props.engine.layers(page, p || undefined).catch(() => [])
          )
        );
        if (page !== viewer.page()) return;
        const next = new Map<string, LayerRow[]>();
        parents.forEach((p, i) => next.set(p, fresh[i]));
        setChildren(next);
      },
      { defer: true }
    )
  );
  createEffect(
    on(viewer.collapseSignal, () => setExpanded(new Set<string>()), {
      defer: true,
    })
  );

  const selectedIds = createMemo(
    () => new Set(viewer.selected().map((s) => s.id))
  );

  const rows = createMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    const map = children();
    const open = expanded();
    const selected = selectedIds();
    const pageId = viewer.pages[viewer.page()]?.id ?? '';
    const walk = (parent: string, depth: number, inSelection: boolean) => {
      const siblings = map.get(parent) ?? [];
      siblings.forEach((row, k) => {
        const isOpen = open.has(row.id) && row.childCount > 0;
        out.push({
          row,
          depth,
          expanded: isOpen,
          inSelection,
          parent: parent || pageId,
          index: siblings.length - 1 - k,
        });
        if (isOpen)
          walk(row.id, depth + 1, inSelection || selected.has(row.id));
      });
    };
    walk(ROOT, 0, false);
    return out;
  });

  const toggle = (row: LayerRow) => {
    const next = new Set(expanded());
    if (next.has(row.id)) next.delete(row.id);
    else {
      next.add(row.id);
      void load(row.id);
    }
    setExpanded(next);
  };

  // Reveal the selection: expand its ancestors and scroll to it.
  createEffect(
    on(
      viewer.revealSignal,
      async () => {
        const first = viewer.selected()[0];
        if (!first) return;
        const chain = await props.engine.ancestry(viewer.page(), first.id);
        const next = new Set(expanded());
        for (const r of chain.slice(0, -1)) {
          next.add(r.id);
          await load(r.id);
        }
        setExpanded(next);
        queueMicrotask(() => {
          const at = rows().findIndex((r) => r.row.id === first.id);
          if (at >= 0) list?.scrollToIndex(at, { align: 'nearest' });
        });
      },
      { defer: true }
    )
  );

  // ---- editing ---------------------------------------------------------

  const [renaming, setRenaming] = createSignal<string>();
  const [renamingPage, setRenamingPage] = createSignal<string>();

  const renamePage = (id: string, old: string, name: string) => {
    setRenamingPage(undefined);
    const trimmed = name.trim();
    if (!trimmed || trimmed === old) return;
    void props.editor?.apply([
      { op: 'set', ids: [id], props: { name: trimmed } },
    ]);
  };

  const addPage = async () => {
    const result = await props.editor?.apply([
      {
        op: 'create',
        parent: props.engine.summary.rootId,
        node: { type: 'CANVAS', x: 0, y: 0, width: 0, height: 0 },
      },
    ]);
    const id = result?.created[0];
    if (!id) return;
    const index = viewer.pages.findIndex((p) => p.id === id);
    if (index >= 0) {
      await viewer.openPage(index);
      setRenamingPage(id);
    }
  };
  const editable = (row: LayerRow) =>
    !!props.editor?.enabled() && !row.id.startsWith('I');

  const rename = (row: LayerRow, name: string) => {
    setRenaming(undefined);
    const trimmed = name.trim();
    if (!trimmed || trimmed === row.name) return;
    void props.editor?.apply([
      { op: 'set', ids: [row.id], props: { name: trimmed } },
    ]);
  };

  createEffect(
    on(
      viewer.renameSignal,
      () => {
        const first = viewer.selected()[0];
        if (first && props.editor?.enabled() && !first.id.startsWith('I'))
          setRenaming(first.id);
      },
      { defer: true }
    )
  );

  const toggleFlag = (row: LayerRow, flag: 'visible' | 'locked') =>
    void props.editor?.apply([
      {
        op: 'set',
        ids: [row.id],
        props:
          flag === 'visible'
            ? { visible: !row.visible }
            : { locked: !row.locked },
      },
    ]);

  const [dragging, setDragging] = createSignal<string[]>();
  const [drop, setDrop] = createSignal<{ id: string; zone: DropZone }>();

  const zoneFor = (e: DragEvent, item: FlatRow): DropZone => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    const container = ['FRAME', 'GROUP', 'SECTION', 'SYMBOL'].includes(
      item.row.type
    );
    if (container && t > 0.3 && t < 0.7) return 'inside';
    return t < 0.5 ? 'above' : 'below';
  };

  const onDrop = (item: FlatRow) => {
    const ids = dragging();
    const target = drop();
    setDragging(undefined);
    setDrop(undefined);
    if (!ids || !target || ids.includes(item.row.id)) return;
    // The list shows the top-most layer first; "above" is in front.
    const op =
      target.zone === 'inside'
        ? { parent: item.row.id, index: item.row.childCount }
        : {
            parent: item.parent,
            index: target.zone === 'above' ? item.index + 1 : item.index,
          };
    void props.editor?.apply([{ op: 'reorder', ids, ...op }]);
  };

  let searchRun = 0;
  const search = async (q: string) => {
    setQuery(q);
    const run = ++searchRun;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const hits = await props.engine.search(viewer.page(), q.trim(), 300);
    if (run === searchRun) setResults(hits);
  };

  // Shift-click selects the rows between the last clicked one and this
  // one; ⌘/Ctrl-click toggles a row (Figma's layer list).
  let anchor: string | undefined;
  let tree: HTMLDivElement | undefined;
  const onRowClick = (row: LayerRow, e: MouseEvent) => {
    // The range starts at the last clicked row, or at the selection made
    // elsewhere (the canvas, search).
    const selected = viewer.selected();
    const from = selected.some((s) => s.id === anchor)
      ? anchor
      : selected.at(-1)?.id;
    const click = rowClick(
      rows().map((r) => r.row.id),
      row.id,
      from,
      { shift: e.shiftKey, toggle: IS_MAC ? e.metaKey : e.ctrlKey }
    );
    if (!e.shiftKey) anchor = row.id;
    tree?.focus({ preventScroll: true });
    if (click.kind === 'toggle') void viewer.selectIds([click.id], true);
    else void viewer.selectIds(click.ids);
  };

  /** Arrow keys move through the rows shown, and expand or collapse. */
  const onTreeKey = (e: KeyboardEvent) => {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      (e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight')
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const shown = rows();
    const move = treeMove(
      shown.map((r) => ({
        id: r.row.id,
        parent: r.depth > 0 ? r.parent : undefined,
        hasChildren: r.row.childCount > 0,
        expanded: r.expanded,
      })),
      viewer.selected().at(-1)?.id,
      e.key
    );
    if (!move) return;
    if (move.kind === 'select') {
      anchor = move.id;
      void viewer.selectIds([move.id]);
      return;
    }
    const row = shown.find((r) => r.row.id === move.id)?.row;
    if (row) toggle(row);
  };

  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="fig-layers-panel"
    >
      <div class="flex h-9 shrink-0 items-center gap-1.5 border-edge-muted border-b px-2">
        <MagnifyingGlass class="size-3.5 shrink-0 text-ink-muted" />
        <input
          ref={props.searchRef}
          type="search"
          placeholder="Find layers"
          aria-label="Find layers"
          data-testid="fig-layer-search"
          class="h-7 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
          value={query()}
          onInput={(e) => void search(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              void search('');
              e.currentTarget.blur();
            }
          }}
        />
        <Show when={query()}>
          <button
            type="button"
            aria-label="Clear search"
            class="rounded p-0.5 text-ink-muted hover:text-ink"
            onClick={() => void search('')}
          >
            <XIcon class="size-3" />
          </button>
        </Show>
      </div>
      <Show when={!query()}>
        <div class="relative shrink-0 border-edge-muted border-b py-1">
          <button
            type="button"
            class="flex h-7 w-full items-center gap-1 px-2 font-medium"
            onClick={() => setPagesOpen((o) => !o)}
          >
            <Show when={pagesOpen()} fallback={<CaretRight class="size-3" />}>
              <CaretDown class="size-3" />
            </Show>
            <span class="flex-1 text-left">Pages</span>
          </button>
          <Show when={props.editor?.enabled()}>
            <button
              type="button"
              aria-label="Add page"
              data-testid="fig-page-add"
              class="absolute top-1.5 right-2 rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => void addPage()}
            >
              <Plus class="size-3.5" />
            </button>
          </Show>
          <Show when={pagesOpen()}>
            <div class="max-h-48 overflow-y-auto">
              <For each={viewer.pages}>
                {(p) => (
                  <Show
                    when={!isPageDivider(p.name)}
                    fallback={
                      <div class="flex h-3 items-center px-6" role="separator">
                        <div class="h-px w-full bg-edge-muted" />
                      </div>
                    }
                  >
                    <Show
                      when={renamingPage() === p.id}
                      fallback={
                        <div
                          class="group flex h-7 w-full items-center pr-2 pl-6 hover:bg-hover"
                          classList={{
                            'font-semibold bg-selected':
                              p.index === viewer.page(),
                          }}
                        >
                          <button
                            type="button"
                            data-testid="fig-page"
                            class="min-w-0 flex-1 truncate text-left"
                            onClick={() => void viewer.openPage(p.index)}
                            onDblClick={() => {
                              if (props.editor?.enabled())
                                setRenamingPage(p.id);
                            }}
                          >
                            {p.name}
                          </button>
                          <Show
                            when={
                              props.editor?.enabled() && viewer.pages.length > 1
                            }
                          >
                            <button
                              type="button"
                              aria-label={`Delete ${p.name}`}
                              data-testid="fig-page-delete"
                              class="invisible rounded p-0.5 text-ink-muted hover:text-ink group-hover:visible"
                              onClick={() =>
                                void props.editor?.apply([
                                  { op: 'delete', ids: [p.id] },
                                ])
                              }
                            >
                              <Trash class="size-3" />
                            </button>
                          </Show>
                        </div>
                      }
                    >
                      <input
                        ref={(el) => queueMicrotask(() => el.select())}
                        class="mx-4 h-6 w-[calc(100%-2rem)] rounded-sm bg-input px-1 text-ink outline outline-1 outline-accent"
                        data-testid="fig-page-rename"
                        value={p.name}
                        onBlur={(e) =>
                          renamePage(p.id, p.name, e.currentTarget.value)
                        }
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (isCommitKey(e)) e.currentTarget.blur();
                          if (e.key === 'Escape') setRenamingPage(undefined);
                        }}
                      />
                    </Show>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <div
        ref={tree}
        // Takes the keys after a row is clicked (arrows move in the tree).
        tabIndex={-1}
        aria-label="Layers"
        data-testid="fig-layer-tree"
        class="relative min-h-0 flex-1 outline-none"
        onKeyDown={onTreeKey}
      >
        <Show
          when={!query()}
          fallback={
            <div class="h-full overflow-y-auto py-1">
              <Show
                when={results().length > 0}
                fallback={
                  <div class="px-3 py-2 text-ink-muted">No matching layers</div>
                }
              >
                <For each={results()}>
                  {(hit) => (
                    <button
                      type="button"
                      data-testid="fig-search-hit"
                      class="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-hover"
                      classList={{ 'bg-selected': selectedIds().has(hit.id) }}
                      onClick={() => viewer.revealLayer(hit.id)}
                    >
                      <LayerIcon
                        type={hit.type}
                        class="mt-0.5 size-3.5 shrink-0"
                      />
                      <span class="min-w-0">
                        <span class="block truncate">{hit.name}</span>
                        <Show when={hit.text && hit.text !== hit.name}>
                          <span class="block truncate text-ink-muted">
                            {hit.text}
                          </span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          }
        >
          <VList
            ref={(h) => {
              list = h;
            }}
            data={rows()}
            itemSize={ROW_HEIGHT}
            class="h-full"
            style={{ height: '100%', width: '100%' }}
          >
            {(item) => (
              <div
                role="treeitem"
                aria-selected={selectedIds().has(item.row.id)}
                aria-expanded={
                  item.row.childCount > 0 ? item.expanded : undefined
                }
                data-testid="fig-layer-row"
                data-layer-id={item.row.id}
                class="group relative flex items-center gap-1 pr-2"
                classList={{
                  'bg-accent/20': selectedIds().has(item.row.id),
                  'bg-accent/5':
                    !selectedIds().has(item.row.id) && item.inSelection,
                  'hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-accent':
                    !selectedIds().has(item.row.id),
                  'text-ink-muted': !item.row.visible,
                  'text-purple':
                    isComponentType(item.row.type) || item.row.inInstance,
                }}
                style={{
                  height: `${ROW_HEIGHT}px`,
                  'padding-left': `${8 + item.depth * 14}px`,
                }}
                draggable={editable(item.row) && renaming() !== item.row.id}
                onDragStart={(e) => {
                  const ids = selectedIds().has(item.row.id)
                    ? [...selectedIds()].filter((id) => !id.startsWith('I'))
                    : [item.row.id];
                  setDragging(ids);
                  e.dataTransfer?.setData('text/plain', ids.join(','));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragging()) return;
                  e.preventDefault();
                  setDrop({ id: item.row.id, zone: zoneFor(e, item) });
                }}
                onDragLeave={() => {
                  if (drop()?.id === item.row.id) setDrop(undefined);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(item);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setDrop(undefined);
                }}
                onPointerEnter={() => viewer.hoverLayer(item.row)}
                onPointerLeave={() => viewer.hoverLayer(undefined)}
                onClick={(e) => onRowClick(item.row, e)}
                onDblClick={() => {
                  if (editable(item.row)) setRenaming(item.row.id);
                  else viewer.zoomToSelection();
                }}
              >
                <Show when={drop()?.id === item.row.id}>
                  <div
                    class="pointer-events-none absolute right-1 left-1 border-accent"
                    classList={{
                      'top-0 border-t-2': drop()?.zone === 'above',
                      'bottom-0 border-b-2': drop()?.zone === 'below',
                      'inset-y-0 rounded border-2': drop()?.zone === 'inside',
                    }}
                  />
                </Show>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={item.expanded ? 'Collapse' : 'Expand'}
                  class="flex size-4 shrink-0 items-center justify-center text-ink-muted"
                  classList={{ invisible: item.row.childCount === 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(item.row);
                  }}
                >
                  <Show
                    when={item.expanded}
                    fallback={<CaretRight class="size-2.5" />}
                  >
                    <CaretDown class="size-2.5" />
                  </Show>
                </button>
                <LayerIcon type={item.row.type} />
                <Show
                  when={renaming() === item.row.id}
                  fallback={
                    <span
                      class="min-w-0 flex-1 truncate"
                      classList={{ italic: item.row.isMask }}
                    >
                      {item.row.name}
                    </span>
                  }
                >
                  <input
                    ref={(el) => queueMicrotask(() => el.select())}
                    class="min-w-0 flex-1 rounded-sm bg-input px-1 text-ink outline outline-1 outline-accent"
                    data-testid="fig-layer-rename"
                    value={item.row.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => rename(item.row, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (isCommitKey(e)) e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(undefined);
                    }}
                  />
                </Show>
                <Show
                  when={editable(item.row)}
                  fallback={
                    <>
                      <Show when={item.row.locked}>
                        <LockSimple class="size-3 shrink-0 text-ink-muted" />
                      </Show>
                      <Show when={!item.row.visible}>
                        <EyeSlash class="size-3 shrink-0 text-ink-muted" />
                      </Show>
                    </>
                  }
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={item.row.locked ? 'Unlock' : 'Lock'}
                    class="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
                    classList={{
                      'invisible group-hover:visible': !item.row.locked,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFlag(item.row, 'locked');
                    }}
                  >
                    <Show
                      when={item.row.locked}
                      fallback={<LockSimpleOpen class="size-3" />}
                    >
                      <LockSimple class="size-3" />
                    </Show>
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={item.row.visible ? 'Hide' : 'Show'}
                    data-testid="fig-layer-visibility"
                    class="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
                    classList={{
                      'invisible group-hover:visible': item.row.visible,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFlag(item.row, 'visible');
                    }}
                  >
                    <Show
                      when={item.row.visible}
                      fallback={<EyeSlash class="size-3" />}
                    >
                      <Eye class="size-3" />
                    </Show>
                  </button>
                </Show>
              </div>
            )}
          </VList>
        </Show>
      </div>
    </div>
  );
}
