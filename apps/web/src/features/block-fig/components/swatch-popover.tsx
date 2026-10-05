/**
 * A color swatch that opens a popover beside the design panel, as Figma's
 * paint and color pickers open. Keys typed in the popover stay in it (so
 * Delete or Escape do not reach the canvas), except ⌘/Ctrl shortcuts.
 */

import { Popover } from '@kobalte/core/popover';
import { Layer } from '@ui';
import type { JSX } from 'solid-js';

const CHECKER =
  'repeating-conic-gradient(var(--color-edge-muted) 0% 25%, transparent 0% 50%) 50% / 8px 8px';

export function SwatchPopover(props: {
  /** CSS background of the swatch. */
  swatch: string;
  label: string;
  testId?: string;
  disabled?: boolean;
  class?: string;
  onOpenChange?: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <Popover
      placement="left-start"
      // Beside the design panel, as Figma opens its pickers.
      gutter={40}
      onOpenChange={(open) => props.onOpenChange?.(open)}
    >
      <Popover.Trigger
        aria-label={props.label}
        title={props.label}
        data-testid={props.testId}
        disabled={props.disabled}
        class={`relative size-4 shrink-0 overflow-hidden rounded-sm border border-edge-muted ${props.class ?? ''}`}
        style={{ background: CHECKER }}
      >
        <span class="absolute inset-0" style={{ background: props.swatch }} />
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="z-modal rounded-xl border border-edge-muted bg-menu p-3 shadow-xl outline-none"
            aria-label={props.label}
            onKeyDown={(e: KeyboardEvent) => {
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            {props.children}
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
