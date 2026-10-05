/**
 * The Assets tab: the file's components, grouped by component set, then
 * the assets of the team libraries it uses. Editors click one to place an
 * instance in the middle of the view; anyone can jump to a main component.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { ComponentInfo } from '@core/fig-engine/types';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
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
      <label class="flex items-center gap-2 border-edge-muted border-b px-3 py-2 text-xs">
        <MagnifyingGlass class="size-3.5 text-ink-muted" />
        <input
          class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
          placeholder="Search components"
          data-testid="fig-assets-search"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Show when={props.libraries}>
          {(libraries) => (
            <LibrariesButton
              libraries={libraries()}
              fileName={props.fileName ?? 'This file'}
            />
          )}
        </Show>
      </label>
      <div class="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
        <Show
          when={groups().length > 0}
          fallback={
            <p class="px-3 py-2 text-ink-muted">
              {query()
                ? 'No matching components.'
                : 'No components yet. Select layers and press ⌥⌘K.'}
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
                <For each={list}>
                  {(c) => (
                    <div class="group flex items-center gap-2 px-3 py-1 hover:bg-hover">
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 text-left text-ink"
                        data-testid="fig-asset"
                        title={
                          props.editor?.enabled()
                            ? 'Place an instance'
                            : 'Go to component'
                        }
                        onClick={() =>
                          props.editor?.enabled()
                            ? void props.editor.insertInstance(c)
                            : void jump(c)
                        }
                      >
                        <DiamondsFour class="size-3.5 shrink-0 text-accent" />
                        <span class="truncate">{c.name}</span>
                      </button>
                      <Show when={props.editor?.enabled()}>
                        <button
                          type="button"
                          aria-label="Go to main component"
                          class="rounded p-0.5 text-ink-muted opacity-0 hover:text-ink group-hover:opacity-100"
                          onClick={() => void jump(c)}
                        >
                          <ArrowSquareOut class="size-3.5" />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
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
