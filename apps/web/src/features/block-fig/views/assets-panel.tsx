/**
 * The Assets tab: the file's components, grouped by component set, then
 * the assets of the team libraries it uses. Editors click one to place an
 * instance in the middle of the view; anyone can jump to a main component.
 */

import { IS_MAC } from '@core/constant/isMac';
import type { FigEngine } from '@core/fig-engine/client';
import type { ComponentInfo } from '@core/fig-engine/types';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import List from '@phosphor/list.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import X from '@phosphor/x.svg';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { ComponentPreview } from '../components/component-preview';
import type { FigEditor } from '../primitives/create-fig-editor';
import type { FigLibraries } from '../primitives/create-fig-libraries';
import type { FigViewer } from '../primitives/create-fig-viewer';
import { LibrariesButton, LibrarySections } from './library-views';

export function AssetsPanel(props: {
  viewer: FigViewer;
  engine: FigEngine;
  editor?: FigEditor;
  /** Team libraries, where the app provides other designs. */
  libraries?: FigLibraries;
  fileName?: string;
}) {
  const [query, setQuery] = createSignal('');
  const [grid, setGrid] = createSignal(true);
  const previews = new Map<string, { revision: number; blob: Promise<Blob> }>();
  const thumbnail = (component: ComponentInfo) => {
    const revision = props.viewer.editsSettled();
    const cached = previews.get(component.id);
    if (cached?.revision === revision) return cached.blob;
    const scale = Math.min(
      1,
      192 / Math.max(component.width, component.height, 1)
    );
    const blob = props.engine.exportPng(component.page, component.id, scale);
    previews.set(component.id, { revision, blob });
    // Browsing a large library should not retain every preview in memory.
    if (previews.size > 64) {
      const oldest = previews.keys().next().value;
      if (oldest) previews.delete(oldest);
    }
    return blob;
  };
  // File-wide, so once per pause in a stream of edits (a drag's steps).
  const [components] = createResource(
    () => props.viewer.editsSettled(),
    () => props.engine.components(),
    { initialValue: [] }
  );
  const groups = createMemo(() => {
    const q = query().trim().toLowerCase();
    const map = new Map<string, ComponentInfo[]>();
    for (const c of components.latest ?? []) {
      const label = c.set ? `${c.set} ${c.name}` : c.name;
      if (q && !label.toLowerCase().includes(q)) continue;
      const key = c.set ?? '';
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  });

  const jump = async (c: ComponentInfo) => {
    if (props.viewer.page() !== c.page) await props.viewer.openPage(c.page);
    await props.viewer.selectIds([c.id]);
    props.viewer.zoomToSelection();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-testid="fig-assets">
      <div class="flex h-10 shrink-0 items-center justify-between px-3 text-xs">
        <span class="font-medium">Assets</span>
        <Show when={props.libraries}>
          {(libraries) => (
            <LibrariesButton
              libraries={libraries()}
              fileName={props.fileName ?? 'This file'}
            />
          )}
        </Show>
      </div>
      <div class="flex items-center gap-1 px-3 pb-3 text-xs">
        <label class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-inset px-2 py-1.5 focus-within:ring-1 focus-within:ring-accent">
          <MagnifyingGlass class="size-3.5 shrink-0 text-ink-muted" />
          <input
            class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
            placeholder="Search all libraries"
            aria-label="Search assets"
            data-testid="fig-assets-search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <Show when={query()}>
          <button
            type="button"
            aria-label="Clear asset search"
            class="rounded p-1 text-ink-muted hover:bg-hover"
            onClick={() => setQuery('')}
          >
            <X class="size-3.5" />
          </button>
        </Show>
      </div>
      <div class="flex items-center justify-between px-3 pb-2 text-xs">
        <span class="font-medium">Created in this file</span>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Grid view"
            title="Grid view"
            aria-pressed={grid()}
            data-testid="fig-assets-grid"
            class="rounded p-1 text-ink-muted hover:bg-hover aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => setGrid(true)}
          >
            <SquaresFour class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="List view"
            title="List view"
            aria-pressed={!grid()}
            data-testid="fig-assets-list"
            class="rounded p-1 text-ink-muted hover:bg-hover aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => setGrid(false)}
          >
            <List class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
        <Show
          when={groups().length > 0}
          fallback={
            <p class="px-3 py-2 text-ink-muted">
              {query()
                ? 'No matching components.'
                : props.editor?.enabled()
                  ? `No components yet. Select layers and press ${IS_MAC ? '⌥⌘K' : 'Ctrl+Alt+K'}.`
                  : 'No components in this file.'}
            </p>
          }
        >
          <For each={groups()}>
            {([set, list]) => (
              <div class="py-1">
                <Show when={set}>
                  <div class="px-3 py-1 font-semibold text-ink-muted">
                    {set}
                  </div>
                </Show>
                <div classList={{ 'grid grid-cols-2 gap-2 px-3': grid() }}>
                  <For each={list}>
                    {(component) => (
                      <div
                        class="group relative min-w-0 rounded-md hover:bg-hover"
                        classList={{
                          'flex items-center gap-2 px-3 py-2': !grid(),
                          'p-1': grid(),
                        }}
                      >
                        <button
                          type="button"
                          data-testid="fig-asset"
                          aria-label={component.name}
                          class="flex min-w-0 flex-1 gap-2 text-left text-ink"
                          classList={{
                            'w-full flex-col': grid(),
                            'items-center': !grid(),
                          }}
                          title={
                            props.editor?.enabled()
                              ? `Place ${component.name}`
                              : `Go to ${component.name}`
                          }
                          onClick={() =>
                            props.editor?.enabled()
                              ? void props.editor.insertInstance(component)
                              : void jump(component)
                          }
                        >
                          <Show
                            when={grid()}
                            fallback={
                              <DiamondsFour class="size-3.5 shrink-0 text-accent" />
                            }
                          >
                            <ComponentPreview
                              load={() => thumbnail(component)}
                            />
                          </Show>
                          <span class="w-full truncate text-[11px]">
                            {component.name}
                          </span>
                        </button>
                        <Show when={props.editor?.enabled()}>
                          <button
                            type="button"
                            aria-label="Go to main component"
                            class="rounded bg-panel p-1 text-ink-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                            classList={{ 'absolute top-2 right-2': grid() }}
                            onClick={() => void jump(component)}
                          >
                            <ArrowSquareOut class="size-3.5" />
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
        <Show when={props.libraries}>
          {(libraries) => (
            <LibrarySections
              libraries={libraries()}
              query={query()}
              hasSelection={props.viewer.selected().length > 0}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
