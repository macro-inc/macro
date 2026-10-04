/**
 * The left panel: the file's pages and the current page's layer tree,
 * loaded lazily as rows expand, with search (⌘F).
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { LayerRow, SearchHit } from '@core/fig-engine/types';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import LockSimple from '@phosphor/lock-simple.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
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
import { isPageDivider } from '../core/pages';
import type { FigViewer } from '../primitives/create-fig-viewer';

const ROOT = '';
const ROW_HEIGHT = 28;

interface FlatRow {
  row: LayerRow;
  depth: number;
  expanded: boolean;
  /** Inside a selected layer (Figma tints these rows). */
  inSelection: boolean;
}

export function LayersPanel(props: {
  viewer: FigViewer;
  engine: FigEngine;
  /** Where ⌘F focuses. */
  searchRef?: (el: HTMLInputElement) => void;
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
    const walk = (parent: string, depth: number, inSelection: boolean) => {
      for (const row of map.get(parent) ?? []) {
        const isOpen = open.has(row.id) && row.childCount > 0;
        out.push({ row, depth, expanded: isOpen, inSelection });
        if (isOpen)
          walk(row.id, depth + 1, inSelection || selected.has(row.id));
      }
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

  const onRowClick = (row: LayerRow, e: MouseEvent) => {
    if (e.shiftKey) void viewer.selectIds([row.id], true);
    else void viewer.selectIds([row.id]);
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
        <div class="shrink-0 border-edge-muted border-b py-1">
          <button
            type="button"
            class="flex h-7 w-full items-center gap-1 px-2 font-medium"
            onClick={() => setPagesOpen((o) => !o)}
          >
            <Show when={pagesOpen()} fallback={<CaretRight class="size-3" />}>
              <CaretDown class="size-3" />
            </Show>
            Pages
          </button>
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
                    <button
                      type="button"
                      data-testid="fig-page"
                      class="flex h-7 w-full items-center truncate px-6 text-left hover:bg-hover"
                      classList={{
                        'font-semibold bg-selected': p.index === viewer.page(),
                      }}
                      onClick={() => void viewer.openPage(p.index)}
                    >
                      <span class="truncate">{p.name}</span>
                    </button>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <div class="relative min-h-0 flex-1">
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
                class="group flex items-center gap-1 pr-2"
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
                onPointerEnter={() => viewer.hoverLayer(item.row)}
                onPointerLeave={() => viewer.hoverLayer(undefined)}
                onClick={(e) => onRowClick(item.row, e)}
                onDblClick={() => viewer.zoomToSelection()}
              >
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
                <span
                  class="min-w-0 flex-1 truncate"
                  classList={{ italic: item.row.isMask }}
                >
                  {item.row.name}
                </span>
                <Show when={item.row.locked}>
                  <LockSimple class="size-3 shrink-0 text-ink-muted" />
                </Show>
                <Show when={!item.row.visible}>
                  <EyeSlash class="size-3 shrink-0 text-ink-muted" />
                </Show>
              </div>
            )}
          </VList>
        </Show>
      </div>
    </div>
  );
}
