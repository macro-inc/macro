/**
 * The equation editor, floating over the slide: the equation's linear text
 * (LaTeX-style), a live preview, and what is wrong with the text. Shown
 * while writing a new equation and while one is selected on the slide.
 */

import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { onMount, Show } from 'solid-js';
import type { EquationEditor as Editor } from '../primitives/create-equation-editor';

/** A CSS color (`rgb(…)`, `oklch(…)`, …) as `RRGGBB`, through a canvas. */
function hexOfCss(css: string): string | undefined {
  const ctx = document.createElement('canvas').getContext('2d', {
    willReadFrequently: true,
  });
  if (!ctx) return undefined;
  ctx.canvas.width = 1;
  ctx.canvas.height = 1;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Renders previews in the text color of `el`, so they read on its surface. */
export function matchInk(editor: Editor, el: HTMLElement) {
  const hex = hexOfCss(getComputedStyle(el).color);
  if (hex) editor.setInk(hex);
}

export function EquationEditorPanel(props: {
  editor: Editor;
  readonly: boolean;
}) {
  const eq = props.editor;
  let panel!: HTMLDivElement;
  onMount(() => matchInk(eq, panel));

  const isNew = () => eq.target()?.kind === 'new';

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      eq.close();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void eq.commit();
    }
  };

  return (
    <div
      ref={panel}
      class="absolute top-2 left-1/2 z-20 flex w-[28rem] max-w-[calc(100%-1rem)] -translate-x-1/2 flex-col gap-1.5 rounded-xl border border-edge bg-menu p-2 text-ink shadow-xl"
      data-testid="pptx-equation-editor"
      role="dialog"
      aria-label={isNew() ? 'New equation' : 'Edit equation'}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-1">
        <span class="font-medium text-xs">
          {isNew() ? 'New equation' : 'Equation'}
        </span>
        <span class="text-ink-muted text-xs">
          LaTeX: \frac{'{a}{b}'}, x^2, \sqrt{'{x}'}, \sum_{'{i=1}'}^n
        </span>
        <span class="flex-1" />
        <Button
          size="icon-xs"
          variant="ghost"
          label="Close"
          data-testid="pptx-equation-close"
          onClick={() => eq.close()}
        >
          <X />
        </Button>
      </div>
      <textarea
        ref={(el) => eq.registerInput(el)}
        data-testid="pptx-equation-input"
        aria-label="Equation (linear format)"
        placeholder="Type an equation, e.g. x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}"
        rows={2}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        disabled={props.readonly}
        class="min-h-12 w-full resize-y rounded-md border border-edge-muted bg-input px-2 py-1 font-mono text-ink text-xs outline-none placeholder:text-ink-placeholder focus:border-accent"
        value={eq.latex()}
        onInput={(e) => eq.setLatex(e.currentTarget.value)}
      />
      <div
        class="flex min-h-14 items-center justify-center overflow-auto rounded-md border border-edge-muted px-2 py-1"
        data-testid="pptx-equation-preview"
      >
        <Show
          when={eq.preview()}
          fallback={
            <span class="text-ink-muted text-xs">
              {eq.latex().trim() ? '' : 'The equation appears here'}
            </span>
          }
        >
          {(picture) => (
            <img
              src={picture().url}
              alt={eq.latex()}
              draggable={false}
              style={{
                width: `${picture().width}px`,
                height: `${picture().height}px`,
              }}
            />
          )}
        </Show>
      </div>
      <Show when={eq.error()}>
        <div class="text-failure text-xs" data-testid="pptx-equation-error">
          {eq.error()}
        </div>
      </Show>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="h-6 rounded-md px-1.5 text-xs"
          classList={{
            'bg-accent-bg text-accent': eq.display(),
            'text-ink-muted hover:bg-ink/5': !eq.display(),
          }}
          aria-pressed={eq.display()}
          data-testid="pptx-equation-display"
          disabled={props.readonly}
          onClick={() => eq.setDisplay(!eq.display())}
        >
          Display
        </button>
        <span class="text-ink-muted text-xs">
          {eq.display() ? 'On its own line, centered' : 'Inline with the text'}
        </span>
        <span class="flex-1" />
        <Button
          size="xs"
          variant="cta"
          data-testid="pptx-equation-insert"
          disabled={props.readonly || (isNew() && !eq.latex().trim())}
          onClick={() => void eq.commit()}
        >
          {isNew() ? 'Insert' : 'Done'}
        </Button>
      </div>
    </div>
  );
}
