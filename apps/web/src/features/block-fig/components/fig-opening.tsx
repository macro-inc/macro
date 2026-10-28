/** Keep the editor's geometry stable through download, sync and decoding. */
import './editor-theme.css';
import { For } from 'solid-js';

export function FigOpening() {
  return (
    <div
      class="fig-editor-theme relative flex size-full min-h-0 min-w-0 overflow-hidden bg-page text-ink-muted text-xs"
      data-testid="fig-opening"
      aria-busy="true"
    >
      <div
        class="flex w-[280px] shrink-0 flex-col border-edge-frame border-r bg-page"
        aria-hidden="true"
      >
        <div class="flex h-12 items-center px-4">
          <div class="h-2 w-28 rounded bg-hover" />
        </div>
        <div class="flex h-10 items-center gap-4 border-edge-frame border-b px-4">
          <span>File</span>
          <span>Assets</span>
        </div>
        <div class="border-edge-frame border-b p-4">
          Pages
          <div class="mt-4 h-7 rounded bg-hover" />
        </div>
        <div class="p-4">
          Layers
          <For each={[128, 168, 112, 144, 96]}>
            {(width) => (
              <div
                class="mt-5 h-2 rounded bg-hover"
                style={{ width: `${width}px` }}
              />
            )}
          </For>
        </div>
      </div>
      <div class="relative min-w-0 flex-1" data-testid="fig-opening-canvas">
        <FigLoadingStatus />
      </div>
      <div
        class="w-[240px] shrink-0 border-edge-frame border-l bg-page"
        aria-hidden="true"
      >
        <div class="h-12" />
        <div class="flex h-10 items-center gap-4 border-edge-frame border-b px-4">
          <span>Design</span>
          <span>Prototype</span>
        </div>
        <div class="p-4">
          <div class="h-2 w-12 rounded bg-hover" />
          <div class="mt-5 h-7 rounded bg-hover" />
          <div class="mt-3 h-7 rounded bg-hover" />
        </div>
      </div>
    </div>
  );
}

/** A quiet status in the canvas; never substitutes a differently scaled image. */
export function FigLoadingStatus() {
  return (
    <div
      role="status"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      data-testid="fig-loading-status"
    >
      <span class="rounded-md bg-panel px-3 py-2 text-ink-muted text-xs">
        Opening design…
      </span>
    </div>
  );
}
