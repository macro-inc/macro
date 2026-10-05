/**
 * The floating bar at the bottom of the canvas: undo and redo with the
 * save state when editing, and the zoom menu with the view toggles.
 * Presentational.
 */

import ArrowUUpLeft from '@phosphor/arrow-u-up-left.svg';
import ArrowUUpRight from '@phosphor/arrow-u-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CloudArrowUp from '@phosphor/cloud-arrow-up.svg';
import CloudCheck from '@phosphor/cloud-check.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { SaveState } from '../core/save-state';

export interface MenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  onSelect: () => void;
  testId?: string;
}

/** A menu's items, with dividers between groups. */
export function MenuItems(props: {
  items: (MenuItem | 'divider')[];
  onDone: () => void;
}) {
  return (
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
              props.onDone();
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
  );
}

export function StatusBar(props: {
  editable: boolean;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoomLabel: string;
  zoomItems: (MenuItem | 'divider')[];
  mac: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  let menu!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  const mod = () => (props.mac ? '⌘' : 'Ctrl+');
  return (
    <div
      class="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex items-center gap-0.5 rounded-xl border border-edge-muted bg-menu p-1 shadow-lg"
      data-testid="ai-status-bar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Show when={props.editable}>
        <Button
          variant="ghost"
          size="icon-md"
          label="Undo"
          tooltip={`Undo · ${mod()}Z`}
          disabled={!props.canUndo}
          data-testid="ai-undo"
          onClick={() => props.onUndo()}
        >
          <ArrowUUpLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-md"
          label="Redo"
          tooltip={`Redo · ${props.mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'}`}
          disabled={!props.canRedo}
          data-testid="ai-redo"
          onClick={() => props.onRedo()}
        >
          <ArrowUUpRight />
        </Button>
        <span
          class="flex size-8 items-center justify-center text-ink-muted"
          data-testid="ai-save-state"
          data-state={props.saveState}
          title={match(props.saveState)
            .with('saved', () => 'All changes saved')
            .with('unsaved', () => 'Unsaved changes')
            .with('saving', () => 'Saving…')
            .with('error', () => 'Save failed')
            .exhaustive()}
        >
          {match(props.saveState)
            .with('saved', () => <CloudCheck class="size-4" />)
            .with('error', () => <WarningCircle class="size-4 text-failure" />)
            .otherwise(() => (
              <CloudArrowUp class="size-4 animate-pulse" />
            ))}
        </span>
        <div aria-hidden="true" class="mx-1 h-5 w-px bg-edge-muted" />
      </Show>
      <div ref={menu} class="relative">
        <Button
          variant="ghost"
          size="sm"
          class="min-w-16 gap-0.5 tabular-nums"
          aria-expanded={open()}
          data-testid="ai-zoom-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {props.zoomLabel}
          <CaretDown class="size-3" />
        </Button>
        <Show when={open()}>
          <div class="absolute right-0 bottom-full z-50 mb-2 w-60 rounded-lg border border-edge-muted bg-menu p-1 text-xs shadow-lg">
            <MenuItems items={props.zoomItems} onDone={() => setOpen(false)} />
          </div>
        </Show>
      </div>
    </div>
  );
}
