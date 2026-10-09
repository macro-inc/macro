/**
 * A paint swatch that opens a color picker (the Figma editor's), with
 * "None": the toolbar's fill and stroke, and the properties panel's.
 * Keys typed in the popover stay in it, except ⌘/Ctrl shortcuts.
 * Presentational.
 */

import { ColorPicker } from '@app/features/block-fig/components/color-picker';
import { Popover } from '@kobalte/core/popover';
import { Layer } from '@ui';
import { Button } from '@ui/components/Button';
import { type JSX, Show } from 'solid-js';

const CHECKER =
  'repeating-conic-gradient(var(--color-edge-muted) 0% 25%, transparent 0% 50%) 50% / 8px 8px';

export function PaintSwatch(props: {
  /** CSS background of the swatch (`transparent`: none). */
  swatch: string;
  /** `RRGGBB` the picker starts from. */
  hex: string;
  /** The paint is none (a red slash shows). */
  none: boolean;
  label: string;
  testId?: string;
  /** A stroke swatch: a ring rather than a filled square. */
  ring?: boolean;
  disabled?: boolean;
  /** `null`: none. `live` changes come from dragging in the picker. */
  onChange?: (hex: string | null, live: boolean) => void;
  /** The swatch's size and position (Tailwind classes). */
  class?: string;
  /**
   * Where the picker opens: beside the properties panel (the default), or
   * to the right of the toolbar.
   */
  side?: 'left' | 'right';
  children?: JSX.Element;
}) {
  return (
    <Popover
      placement={props.side === 'right' ? 'right-start' : 'left-start'}
      gutter={props.side === 'right' ? 12 : 40}
    >
      <Popover.Trigger
        aria-label={props.label}
        title={props.label}
        data-testid={props.testId}
        disabled={props.disabled || !props.onChange}
        class={`overflow-hidden rounded-sm border border-edge ${props.class ?? 'size-5'}`}
        style={{ background: CHECKER }}
      >
        {/* Its own positioned box: the caller places the trigger. */}
        <span class="relative block size-full">
          <span
            class="absolute inset-0"
            style={{
              background: props.none ? 'var(--color-surface)' : props.swatch,
            }}
          />
          <Show when={props.ring}>
            <span class="absolute inset-[30%] rounded-[1px] border border-edge bg-surface" />
          </Show>
          <Show when={props.none}>
            <svg
              class="absolute inset-0 size-full"
              viewBox="0 0 10 10"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <line
                x1="0"
                y1="10"
                x2="10"
                y2="0"
                stroke="var(--color-failure)"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </Show>
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="z-modal flex flex-col gap-2 rounded-xl border border-edge-muted bg-menu p-3 text-xs shadow-xl outline-none"
            aria-label={props.label}
            onKeyDown={(e: KeyboardEvent) => {
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            <ColorPicker
              value={props.hex}
              opaque
              onChange={(hex, live) => props.onChange?.(hex.slice(0, 6), live)}
            />
            <Button
              variant="outline"
              size="sm"
              data-testid={props.testId ? `${props.testId}-none` : undefined}
              onClick={() => props.onChange?.(null, false)}
            >
              None
            </Button>
            {props.children}
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
