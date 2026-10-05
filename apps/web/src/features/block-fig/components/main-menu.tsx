/**
 * The main menu at the canvas's top left (Figma's menu): File items such
 * as "Export frames to PDF", and View toggles. Presentational.
 */

import List from '@phosphor/list.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { ZoomMenuItem } from './viewer-toolbar';

export function MainMenu(props: {
  /** Shifted below the top ruler when it shows. */
  rulers: boolean;
  items: (ZoomMenuItem | 'divider')[];
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
      class="absolute z-10"
      classList={{
        'top-2 left-2': !props.rulers,
        'top-7 left-7': props.rulers,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon-md"
        class="border border-edge-muted bg-menu shadow-sm"
        label="Main menu"
        tooltip="Main menu"
        aria-expanded={open()}
        data-testid="fig-main-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <List />
      </Button>
      <Show when={open()}>
        <div class="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-edge-muted bg-menu p-1 text-xs shadow-lg">
          <For each={props.items}>
            {(item) =>
              item === 'divider' ? (
                <div class="my-1 h-px bg-edge-muted" />
              ) : (
                <button
                  type="button"
                  data-testid={item.testId}
                  class="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-hover"
                  onClick={() => {
                    item.onSelect();
                    setOpen(false);
                  }}
                >
                  <span class="w-3 text-accent">{item.checked ? '✓' : ''}</span>
                  <span class="flex-1">{item.label}</span>
                  <Show when={item.shortcut}>
                    <span class="text-ink-muted">{item.shortcut}</span>
                  </Show>
                </button>
              )
            }
          </For>
        </div>
      </Show>
    </div>
  );
}
