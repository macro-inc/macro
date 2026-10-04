/**
 * The floating toolbar at the bottom of the canvas (Figma UI3): tools, and
 * the zoom menu with its view toggles. Presentational.
 */

import CaretDown from '@phosphor/caret-down.svg';
import Hand from '@phosphor/hand.svg';
import Keyboard from '@phosphor/keyboard.svg';
import NavigationArrow from '@phosphor/navigation-arrow.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { Tool } from '../primitives/create-fig-viewer';

export interface ZoomMenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  onSelect: () => void;
  testId?: string;
}

export function ViewerToolbar(props: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  zoomLabel: string;
  zoomItems: (ZoomMenuItem | 'divider')[];
  onShortcuts: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let menu!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));

  return (
    <div
      class="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex items-center gap-0.5 rounded-xl border border-edge-muted bg-menu p-1 shadow-lg"
      data-testid="fig-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon-md"
        aria-pressed={props.tool === 'move'}
        label="Move (V)"
        tooltip="Move · V"
        data-testid="fig-tool-move"
        onClick={() => props.onTool('move')}
      >
        <NavigationArrow class="-scale-x-100" />
      </Button>
      <Button
        variant="ghost"
        size="icon-md"
        aria-pressed={props.tool === 'hand'}
        label="Hand tool (H)"
        tooltip="Hand tool · H"
        data-testid="fig-tool-hand"
        onClick={() => props.onTool('hand')}
      >
        <Hand />
      </Button>
      <div aria-hidden="true" class="mx-1 h-5 w-px bg-edge-muted" />
      <div ref={menu} class="relative">
        <Button
          variant="ghost"
          size="sm"
          class="min-w-16 gap-0.5 tabular-nums"
          aria-expanded={open()}
          data-testid="fig-zoom-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {props.zoomLabel}
          <CaretDown class="size-3" />
        </Button>
        <Show when={open()}>
          <div class="absolute right-0 bottom-full z-50 mb-2 w-56 rounded-lg border border-edge-muted bg-menu p-1 text-xs shadow-lg">
            <For each={props.zoomItems}>
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
                    <span class="w-3 text-accent">
                      {item.checked ? '✓' : ''}
                    </span>
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
      <Button
        variant="ghost"
        size="icon-md"
        label="Keyboard shortcuts"
        tooltip="Keyboard shortcuts · Ctrl⇧?"
        onClick={props.onShortcuts}
      >
        <Keyboard />
      </Button>
    </div>
  );
}
