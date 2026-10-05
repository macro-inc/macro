/**
 * A color swatch that opens the color picker beside it. Presentational.
 */

import type { Rgb } from '@core/psd-engine/types';
import { createSignal, onCleanup, Show } from 'solid-js';
import { css, toHex } from '../core/color';
import { ColorPicker } from './color-picker';

export function ColorSwatch(props: {
  label: string;
  color: Rgb;
  disabled?: boolean;
  testId?: string;
  onChange: (color: Rgb, done: boolean) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div
      ref={root}
      class="relative flex items-center gap-2 text-ink-muted text-xs"
    >
      <span class="w-20 shrink-0">{props.label}</span>
      <button
        type="button"
        aria-label={`${props.label}: #${toHex(props.color)}`}
        title={`#${toHex(props.color)}`}
        data-testid={props.testId}
        disabled={props.disabled}
        class="h-5 w-10 rounded border border-edge-muted disabled:opacity-50"
        style={{ 'background-color': css(props.color) }}
        onClick={() => setOpen((o) => !o)}
      />
      <span class="text-ink tabular-nums">#{toHex(props.color)}</span>
      <Show when={open()}>
        <div
          class="absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-edge-muted bg-menu p-2 shadow-lg"
          data-testid={props.testId ? `${props.testId}-picker` : undefined}
        >
          <ColorPicker color={props.color} onChange={props.onChange} />
        </div>
      </Show>
    </div>
  );
}
