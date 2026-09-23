import { createGraphicsEditor, drawableIds } from '@macro-inc/graphics';
import {
  createGraphicsProjection,
  GraphicsSurface,
} from '@macro-inc/graphics/solid';
import { onCleanup, onMount, Show } from 'solid-js';
import { AnnotationRectangle } from '../components/annotation-rectangle';
import { createLocalImageState } from '../primitives/local-image';

export function ImageMarkupView() {
  const editor = createGraphicsEditor();
  onCleanup(editor.dispose);
  const { camera, document } = createGraphicsProjection(editor);
  let host!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  const viewport = () => ({
    width: host.clientWidth,
    height: host.clientHeight,
  });
  const imageState = createLocalImageState((image) => {
    editor.setImageSurface({
      id: crypto.randomUUID(),
      width: image.width,
      height: image.height,
    });
    editor.fitImage(viewport());
  });
  onMount(() => {
    void imageState.loadDemo();
    const observer = new ResizeObserver(() => editor.centerImage(viewport()));
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  const zoom = (factor: number) =>
    editor.centerImage(viewport(), camera().scale * factor);

  return (
    <div class="@container flex size-full min-h-0 flex-col bg-panel text-ink">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        class="sr-only"
        aria-label="Choose image file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void imageState.load(file);
        }}
      />
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted px-3 py-2">
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1 text-xs hover:bg-input"
          onClick={() => fileInput.click()}
        >
          {imageState.loading()
            ? 'Opening…'
            : imageState.image()
              ? 'Replace image'
              : 'Open image'}
        </button>
        <span class="text-xs text-ink-muted">Rectangle</span>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!imageState.image()}
            class="rounded px-2 py-1 disabled:opacity-40"
            onClick={() => zoom(0.8)}
          >
            −
          </button>
          <output aria-label="Zoom level" class="text-xs tabular-nums">
            {Math.round(camera().scale * 100)}%
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!imageState.image()}
            class="rounded px-2 py-1 disabled:opacity-40"
            onClick={() => zoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            disabled={!imageState.image()}
            class="rounded border border-edge-muted px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => editor.fitImage(viewport())}
          >
            Fit image
          </button>
          <button
            type="button"
            disabled={!drawableIds(document).length}
            class="rounded border border-edge-muted px-2 py-1 text-xs disabled:opacity-40"
            onClick={() => editor.clearRectangles()}
          >
            Clear rectangles
          </button>
        </div>
      </div>
      <Show when={imageState.error()}>
        {(error) => (
          <div role="alert" class="px-3 py-2 text-xs text-failure">
            {error()}
          </div>
        )}
      </Show>
      <div ref={host} class="relative min-h-0 flex-1">
        <Show
          when={imageState.image()}
          fallback={
            <div class="flex size-full items-center justify-center p-4 text-center text-sm text-ink-muted">
              Open an image to draw rectangle annotations. Files stay in this
              browser.
            </div>
          }
        >
          {(image) => (
            <GraphicsSurface
              editor={editor}
              renderers={{ rectangle: AnnotationRectangle }}
              image={{ src: image().src, alt: image().name }}
              input={{
                tool: () => 'rectangle',
                navigation: 'centered-image',
                appearance: () => ({ fill: 'transparent', stroke: '#e53935' }),
              }}
              gridColor="var(--color-edge-muted)"
              class="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            />
          )}
        </Show>
      </div>
      <div class="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-edge-muted px-3 py-2 text-xs text-ink-muted">
        <Show
          when={imageState.image()}
          fallback={<span>Image markup · Local prototype</span>}
        >
          {(image) => (
            <>
              <span class="truncate" title={image().name}>
                {image().name} · {image().width} × {image().height}
              </span>
              <span>
                {drawableIds(document).length}{' '}
                {drawableIds(document).length === 1
                  ? 'rectangle'
                  : 'rectangles'}
              </span>
            </>
          )}
        </Show>
        <span class="hidden @2xl:inline">
          Drag to draw · Scroll to zoom · Esc to cancel
        </span>
      </div>
    </div>
  );
}
