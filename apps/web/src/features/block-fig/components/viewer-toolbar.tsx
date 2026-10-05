/**
 * The floating toolbar at the bottom of the canvas (Figma UI3): tools,
 * undo and redo with the save state when editing, and the zoom menu with
 * its view toggles. Presentational.
 */

import ArrowUUpLeft from '@phosphor/arrow-u-up-left.svg';
import ArrowUUpRight from '@phosphor/arrow-u-up-right.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Circle from '@phosphor/circle.svg';
import CloudArrowUp from '@phosphor/cloud-arrow-up.svg';
import CloudCheck from '@phosphor/cloud-check.svg';
import Hand from '@phosphor/hand.svg';
import Hash from '@phosphor/hash.svg';
import Keyboard from '@phosphor/keyboard.svg';
import LineSegment from '@phosphor/line-segment.svg';
import NavigationArrow from '@phosphor/navigation-arrow.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Square from '@phosphor/square.svg';
import TextT from '@phosphor/text-t.svg';
import Unite from '@phosphor/unite.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { BooleanOperation } from '../core/boolean';
import type { SaveState } from '../primitives/create-fig-editor';
import type { Tool } from '../primitives/create-fig-viewer';
import { BooleanMenuItems } from './boolean-controls';

interface ToolButton {
  tool: Tool;
  label: string;
  key: string;
  icon: (props: { class?: string }) => JSX.Element;
  /** Only when the file is editable. */
  edit: boolean;
}

const TOOLS: ToolButton[] = [
  { tool: 'move', label: 'Move', key: 'V', icon: NavigationArrow, edit: false },
  { tool: 'frame', label: 'Frame', key: 'F', icon: Hash, edit: true },
  { tool: 'rectangle', label: 'Rectangle', key: 'R', icon: Square, edit: true },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle, edit: true },
  { tool: 'line', label: 'Line', key: 'L', icon: LineSegment, edit: true },
  { tool: 'arrow', label: 'Arrow', key: '⇧L', icon: ArrowUpRight, edit: true },
  { tool: 'pen', label: 'Pen', key: 'P', icon: PenNib, edit: true },
  { tool: 'text', label: 'Text', key: 'T', icon: TextT, edit: true },
  { tool: 'hand', label: 'Hand tool', key: 'H', icon: Hand, edit: false },
];

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
  editable?: boolean;
  saveState?: SaveState;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Boolean operations on the selection (when editable and selected). */
  onBoolean?: (operation: BooleanOperation) => void;
  onFlatten?: () => void;
  /** Review tools after the drawing tools (comments, present). */
  review?: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [booleanOpen, setBooleanOpen] = createSignal(false);
  let menu!: HTMLDivElement;
  let booleanMenu: HTMLDivElement | undefined;
  const onDocumentDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) setOpen(false);
    if (!booleanMenu?.contains(e.target as Node)) setBooleanOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));

  const tools = () => TOOLS.filter((t) => props.editable || !t.edit);

  return (
    <div
      class="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex items-center gap-0.5 rounded-xl border border-edge-muted bg-menu p-1 shadow-lg"
      data-testid="fig-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <For each={tools()}>
        {(t) => (
          <Button
            variant="ghost"
            size="icon-md"
            aria-pressed={props.tool === t.tool}
            class={
              props.tool === t.tool ? 'bg-accent/15 text-accent' : undefined
            }
            label={`${t.label} (${t.key})`}
            tooltip={`${t.label} · ${t.key}`}
            data-testid={`fig-tool-${t.tool}`}
            onClick={() => props.onTool(t.tool)}
          >
            {t.icon({ class: t.tool === 'move' ? '-scale-x-100' : undefined })}
          </Button>
        )}
      </For>
      {props.review}
      <Show when={props.editable}>
        <div ref={booleanMenu} class="relative">
          <Button
            variant="ghost"
            size="sm"
            class="gap-0.5 px-1.5"
            label="Boolean groups"
            tooltip="Boolean groups"
            aria-expanded={booleanOpen()}
            disabled={!props.onBoolean}
            data-testid="fig-boolean-menu"
            onClick={() => setBooleanOpen((o) => !o)}
          >
            <Unite class="size-4" />
            <CaretDown class="size-3" />
          </Button>
          <Show when={booleanOpen() && props.onBoolean && props.onFlatten}>
            <div class="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-lg border border-edge-muted bg-menu p-1 text-xs shadow-lg">
              <BooleanMenuItems
                onBoolean={(op) => props.onBoolean?.(op)}
                onFlatten={() => props.onFlatten?.()}
                onDone={() => setBooleanOpen(false)}
              />
            </div>
          </Show>
        </div>
        <div aria-hidden="true" class="mx-1 h-5 w-px bg-edge-muted" />
        <Button
          variant="ghost"
          size="icon-md"
          label="Undo"
          tooltip="Undo · ⌘Z"
          disabled={!props.canUndo}
          data-testid="fig-undo"
          onClick={() => props.onUndo?.()}
        >
          <ArrowUUpLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-md"
          label="Redo"
          tooltip="Redo · ⇧⌘Z"
          disabled={!props.canRedo}
          data-testid="fig-redo"
          onClick={() => props.onRedo?.()}
        >
          <ArrowUUpRight />
        </Button>
        <span
          class="flex size-8 items-center justify-center text-ink-muted"
          data-testid="fig-save-state"
          data-state={props.saveState}
          title={match(props.saveState ?? 'saved')
            .with('saved', () => 'All changes saved')
            .with('unsaved', () => 'Unsaved changes')
            .with('saving', () => 'Saving…')
            .with('error', () => 'Save failed')
            .exhaustive()}
        >
          {match(props.saveState ?? 'saved')
            .with('saved', () => <CloudCheck class="size-4" />)
            .with('error', () => <WarningCircle class="size-4 text-failure" />)
            .otherwise(() => (
              <CloudArrowUp class="size-4 animate-pulse" />
            ))}
        </span>
      </Show>
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
