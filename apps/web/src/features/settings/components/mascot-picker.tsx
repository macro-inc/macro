import { Telemetry } from '@macro-inc/observability';
import { Button } from '@ui';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import {
  MASCOT_COLORS,
  MASCOT_IMAGES,
  type MascotColor,
  renderMascot,
} from '../mascot-image';

export function MascotPicker(props: {
  open: boolean;
  disabled: boolean;
  onApply: (file: File) => Promise<void>;
}) {
  const [mascot, setMascot] = createSignal(0);
  const [color, setColor] = createSignal<MascotColor>(MASCOT_COLORS[0]);
  const [preview, setPreview] = createSignal<{ file: File; url: string }>();
  const [error, setError] = createSignal<string>();
  const [attempt, setAttempt] = createSignal(0);
  const [rendering, setRendering] = createSignal(false);
  let previewUrl: string | undefined;
  onCleanup(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  const canApply = () =>
    !props.disabled && !rendering() && !error() && !!preview();

  // Canvas rendering and object URLs are external resources. Dispose every
  // superseded preview, including renders finishing after selection/unmount.
  createEffect(
    on([() => props.open, mascot, color, attempt], ([isOpen, index, tint]) => {
      setError(undefined);
      if (!isOpen) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = undefined;
        setPreview(undefined);
        setRendering(false);
        return;
      }
      setRendering(true);
      let active = true;
      onCleanup(() => {
        active = false;
      });
      const render = async () => {
        const result = await Telemetry.span(
          'agent.mascot.render',
          async (span) => {
            span.setAttr('mascot.index', index);
            span.setAttr('mascot.color', tint.name);
            const rendered = await renderMascot(MASCOT_IMAGES[index], tint);
            if (rendered.isErr()) {
              span.error(rendered.error[0].message);
            }
            return rendered;
          }
        );
        if (!active) return;
        setRendering(false);
        if (result.isErr()) {
          setError('Could not render mascot. Try again.');
          return;
        }
        const previousUrl = previewUrl;
        previewUrl = URL.createObjectURL(result.value);
        setPreview({ file: result.value, url: previewUrl });
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      };
      void render();
    })
  );

  return (
    <Show when={props.open}>
      <div class="mt-3 flex min-w-0 flex-col gap-4 rounded-xl border border-edge-muted p-3">
        <fieldset class="min-w-0" disabled={props.disabled}>
          <legend class="mb-2 text-xs font-medium text-ink">
            Choose a mascot
          </legend>
          <div class="flex gap-2 overflow-x-auto p-1">
            <For each={MASCOT_IMAGES}>
              {(src, index) => (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Mascot ${index() + 1}`}
                  aria-pressed={mascot() === index()}
                  class="size-16 shrink-0 overflow-hidden rounded-lg border-2 border-transparent p-0 aria-pressed:border-accent"
                  onClick={() => setMascot(index())}
                >
                  <img src={src} alt="" class="size-full object-contain" />
                </Button>
              )}
            </For>
          </div>
        </fieldset>
        <fieldset class="min-w-0" disabled={props.disabled}>
          <legend class="mb-2 text-xs font-medium text-ink">
            Choose a color
          </legend>
          <div class="flex gap-1 overflow-x-auto p-1">
            <For each={MASCOT_COLORS}>
              {(option) => (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={option.name}
                  title={option.name}
                  aria-pressed={color() === option}
                  class="size-11 rounded-full border-2 border-transparent p-0 aria-pressed:border-accent"
                  onClick={() => setColor(option)}
                >
                  <span
                    class="size-7 rounded-full border border-edge-muted"
                    style={{ 'background-color': option.hex }}
                  />
                </Button>
              )}
            </For>
          </div>
        </fieldset>
        <div class="flex flex-wrap items-center gap-3">
          <div
            class="flex size-24 items-center justify-center overflow-hidden rounded-lg bg-surface text-xs text-ink-muted"
            aria-busy={rendering()}
          >
            <Show
              when={preview()}
              fallback={
                <img
                  src={MASCOT_IMAGES[mascot()]}
                  alt="Mascot preview"
                  class="size-full"
                />
              }
            >
              {(image) => (
                <img src={image().url} alt="Mascot preview" class="size-full" />
              )}
            </Show>
          </div>
          <Button
            type="button"
            variant="accent"
            disabled={!canApply()}
            onClick={() => {
              const image = preview();
              if (image && canApply()) void props.onApply(image.file);
            }}
          >
            Use mascot
          </Button>
        </div>
        <Show when={error()}>
          <p role="alert" class="text-sm text-failure">
            {error()}
          </p>
          <Button
            type="button"
            disabled={props.disabled}
            onClick={() => setAttempt(attempt() + 1)}
          >
            Retry preview
          </Button>
        </Show>
      </div>
    </Show>
  );
}
