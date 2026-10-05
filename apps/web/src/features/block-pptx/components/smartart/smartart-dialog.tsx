/**
 * Insert ▸ SmartArt: PowerPoint's Choose a SmartArt Graphic dialog. Pick a
 * category on the left and a layout in the middle; the right side shows it
 * larger with its description. OK (or a double-click) inserts it with
 * "[Text]" prompts.
 */

import type {
  SmartArtCatalog,
  SmartArtPreviewSpec,
} from '@core/pptx-engine/types';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { createSignal, For, Show } from 'solid-js';
import {
  CATEGORIES,
  LAYOUT_DESCRIPTIONS,
  layoutsIn,
} from '../../core/smartart';
import type { PreviewState } from '../../primitives/create-smart-art';
import { SmartArtPreview } from './smartart-preview';

export function SmartArtDialog(props: {
  catalog: SmartArtCatalog | undefined;
  preview: (spec: SmartArtPreviewSpec) => PreviewState;
  onInsert: (layout: string) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = createSignal('all');
  const [picked, setPicked] = createSignal('default');
  const layouts = () => layoutsIn(props.catalog, category());
  const current = () =>
    props.catalog?.layouts.find((l) => l.short === picked()) ?? layouts()[0];
  const choose = (category: string) => {
    setCategory(category);
    const first = layoutsIn(props.catalog, category)[0];
    if (
      first &&
      !layoutsIn(props.catalog, category).some((l) => l.short === picked())
    )
      setPicked(first.short);
  };
  const ok = () => {
    const layout = current();
    if (!layout) return;
    props.onInsert(layout.short);
    props.onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(760px,96vw)]"
    >
      <div
        class="relative flex flex-col gap-3 p-4"
        data-testid="pptx-smartart-dialog"
      >
        <h2 class="font-semibold text-ink text-sm">
          Choose a SmartArt Graphic
        </h2>
        <div class="flex h-[min(420px,60vh)] gap-3">
          <div
            role="listbox"
            aria-label="Categories"
            class="flex w-32 shrink-0 flex-col gap-0.5 overflow-y-auto"
          >
            <For each={CATEGORIES}>
              {(c) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={category() === c.id}
                  data-testid={`pptx-smartart-category-${c.id}`}
                  class="rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5"
                  classList={{
                    'bg-accent-bg text-accent': category() === c.id,
                  }}
                  onClick={() => choose(c.id)}
                >
                  {c.label}
                </button>
              )}
            </For>
          </div>
          <div
            role="listbox"
            aria-label="Layouts"
            class="grid min-w-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-edge-muted p-2"
          >
            <For each={layouts()}>
              {(layout) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={current()?.short === layout.short}
                  aria-label={layout.name}
                  title={layout.name}
                  data-testid={`pptx-smartart-layout-${layout.short}`}
                  class="flex flex-col items-center gap-1 rounded-md border p-1.5 hover:bg-ink/5"
                  classList={{
                    'border-accent bg-accent-bg':
                      current()?.short === layout.short,
                    'border-transparent': current()?.short !== layout.short,
                  }}
                  onClick={() => setPicked(layout.short)}
                  onDblClick={() => {
                    setPicked(layout.short);
                    ok();
                  }}
                >
                  <div class="flex aspect-[4/3] w-full items-center justify-center rounded-sm bg-[white]">
                    <SmartArtPreview
                      paths={props.preview({
                        layout: layout.short,
                        width: 120,
                        height: 90,
                      })}
                      width={120}
                      height={90}
                      class="size-full"
                    />
                  </div>
                  <span class="line-clamp-2 text-center text-[11px] text-ink leading-tight">
                    {layout.name}
                  </span>
                </button>
              )}
            </For>
          </div>
          <div class="flex w-52 shrink-0 flex-col gap-2">
            <Show when={current()}>
              {(layout) => (
                <>
                  <div class="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-edge-muted bg-[white]">
                    <SmartArtPreview
                      paths={props.preview({
                        layout: layout().short,
                        width: 200,
                        height: 150,
                      })}
                      width={200}
                      height={150}
                      class="size-full"
                    />
                  </div>
                  <div
                    class="font-semibold text-ink text-sm"
                    data-testid="pptx-smartart-picked"
                  >
                    {layout().name}
                  </div>
                  <p class="text-ink-muted text-xs leading-snug">
                    {LAYOUT_DESCRIPTIONS[layout().short] ?? ''}
                  </p>
                </>
              )}
            </Show>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            data-testid="pptx-smartart-ok"
            disabled={!current()}
            onClick={ok}
          >
            OK
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          class="absolute top-3 right-3"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
    </Dialog>
  );
}
