/**
 * One library's published assets in the Assets panel: components (click
 * or drag onto the canvas to place an instance), and styles and variables
 * (click to apply to the selection). Presentational.
 */

import type { PublishedAsset } from '@core/fig-engine/library-types';
import BookOpen from '@phosphor/book-open.svg';
import CaretDown from '@phosphor/caret-down.svg';
import { createSignal, For, Show } from 'solid-js';
import { type AssetGroup, LIBRARY_ASSET_MIME } from '../core/libraries';
import { AssetSwatch, AssetThumbnail } from './asset-thumbnail';

export function LibraryAssets(props: {
  library: string;
  name: string;
  /** `undefined` while the library loads. */
  groups: readonly AssetGroup[] | undefined;
  failed?: string;
  canEdit: boolean;
  hasSelection: boolean;
  thumbnail: (asset: PublishedAsset) => Promise<string | null>;
  onInsert: (asset: PublishedAsset) => void;
  onApply: (asset: PublishedAsset) => void;
}) {
  const [open, setOpen] = createSignal(true);
  return (
    <div
      class="border-edge-frame border-t py-1"
      data-testid="fig-library-assets"
      data-library={props.library}
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1 text-left font-semibold text-ink"
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
      >
        <BookOpen class="size-3.5 shrink-0 text-accent" />
        <span class="min-w-0 flex-1 truncate">{props.name}</span>
        <CaretDown
          class="size-3 text-ink-muted transition-transform"
          classList={{ 'rotate-180': open() }}
        />
      </button>
      <Show when={open()}>
        <Show
          when={!props.failed}
          fallback={
            <p class="px-3 py-1 text-ink-muted">
              This library is unavailable: {props.failed}
            </p>
          }
        >
          <Show
            when={props.groups}
            fallback={<p class="px-3 py-1 text-ink-muted">Loading…</p>}
          >
            {(groups) => (
              <For
                each={groups()}
                fallback={
                  <p class="px-3 py-1 text-ink-muted">No matching assets.</p>
                }
              >
                {(g) => (
                  <div class="py-0.5">
                    <Show when={g.title}>
                      <div class="px-3 py-1 text-ink-muted">{g.title}</div>
                    </Show>
                    <Show
                      when={g.kind === 'components'}
                      fallback={
                        <For each={g.assets}>
                          {(a) => (
                            <button
                              type="button"
                              class="flex w-full items-center gap-2 px-3 py-1 text-left text-ink hover:bg-hover disabled:opacity-50"
                              data-testid="fig-library-asset"
                              title={
                                props.hasSelection
                                  ? 'Apply to the selection'
                                  : 'Select layers to apply it'
                              }
                              disabled={!props.canEdit || !props.hasSelection}
                              onClick={() => props.onApply(a)}
                            >
                              <AssetSwatch asset={a} />
                              <span class="truncate">{a.name}</span>
                            </button>
                          )}
                        </For>
                      }
                    >
                      <div class="grid grid-cols-3 gap-1 px-3">
                        <For each={g.assets}>
                          {(a) => (
                            <button
                              type="button"
                              class="flex flex-col items-center gap-1 rounded-md p-1 text-ink hover:bg-hover disabled:opacity-50"
                              data-testid="fig-library-asset"
                              data-key={a.key}
                              title={a.description ?? a.name}
                              disabled={!props.canEdit}
                              draggable={props.canEdit}
                              onDragStart={(e) => {
                                e.dataTransfer?.setData(
                                  LIBRARY_ASSET_MIME,
                                  JSON.stringify({
                                    library: props.library,
                                    key: a.key,
                                  })
                                );
                                if (e.dataTransfer)
                                  e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onClick={() => props.onInsert(a)}
                            >
                              <AssetThumbnail
                                src={() => props.thumbnail(a)}
                                label={a.name}
                                class="h-12 w-full"
                              />
                              <span class="w-full truncate text-center text-[11px]">
                                {a.set ? a.name : a.name.split('/').pop()}
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
