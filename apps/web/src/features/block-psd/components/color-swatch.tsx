/**
 * A color swatch that opens the color picker beside it (drawn over the
 * page, so the panel's scrolling does not clip it). Presentational.
 */

import type { Rgb } from '@core/psd-engine/types';
import { createSignal, onCleanup, Show } from 'solid-js';
import { css, toHex } from '../core/color';
import { ColorPicker } from './color-picker';
import { Floating } from './floating';

export function ColorSwatch(props: {
  label: string;
  color: Rgb;
  disabled?: boolean;
  testId?: string;
  onChange: (color: Rgb, done: boolean) => void;
}) {
  /** The swatch's rectangle while the picker is open. */
  const [open, setOpen] = createSignal<DOMRect>();
  let root!: HTMLDivElement;
  let picker: HTMLDivElement | undefined;
  const onDocumentDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!root.contains(target) && !picker?.contains(target)) setOpen(undefined);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div ref={root} class="flex items-center gap-2 text-ink-muted text-xs">
      <span class="w-20 shrink-0">{props.label}</span>
      <button
        type="button"
        aria-label={`${props.label}: #${toHex(props.color)}`}
        title={`#${toHex(props.color)}`}
        data-testid={props.testId}
        disabled={props.disabled}
        class="h-5 w-10 rounded border border-edge-muted disabled:opacity-50"
        style={{ 'background-color': css(props.color) }}
        onClick={(e) =>
          setOpen(open() ? undefined : e.currentTarget.getBoundingClientRect())
        }
      />
      <span class="text-ink tabular-nums">#{toHex(props.color)}</span>
      <Show when={open()}>
        {(anchor) => (
          <Floating
            anchor={anchor()}
            ref={(el) => {
              picker = el;
            }}
            class="w-56 rounded-lg border border-edge-muted bg-menu p-2 shadow-lg"
            testId={props.testId ? `${props.testId}-picker` : undefined}
          >
            <ColorPicker color={props.color} onChange={props.onChange} />
          </Floating>
        )}
      </Show>
    </div>
  );
}
