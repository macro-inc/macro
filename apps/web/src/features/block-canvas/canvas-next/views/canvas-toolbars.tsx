import { TOKENS } from '@core/hotkey/tokens';
import Undo from '@phosphor/arrow-u-up-left.svg';
import Redo from '@phosphor/arrow-u-up-right.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import Circle from '@phosphor/circle.svg';
import Cursor from '@phosphor/cursor.svg';
import Eraser from '@phosphor/eraser.svg';
import Hand from '@phosphor/hand.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Text from '@phosphor/text-t.svg';
import { Button, Dropdown, Hotkey, Toolbar } from '@ui';
import { type ComponentProps, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasSnapMode } from '../core/snapping';
import type {
  CanvasState,
  CanvasTool,
} from '../primitives/create-canvas-state';

const tools = [
  { id: 'select', label: 'Select', icon: Cursor, key: 'v' },
  { id: 'pan', label: 'Hand', icon: Hand, key: 'h' },
  { id: 'rectangle', label: 'Rectangle', icon: Rectangle, key: 'r' },
  { id: 'ellipse', label: 'Ellipse', icon: Circle, key: 'o' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'a' },
  { id: 'pencil', label: 'Pencil', icon: Pencil, key: 'p' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, key: 'e' },
  { id: 'text', label: 'Text', icon: Text, key: 't' },
] as const;

export function CanvasDrawingToolbar(props: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
}) {
  return (
    <div class="pointer-events-none absolute bottom-4 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2">
      <Toolbar
        size="icon-md"
        aria-label="Drawing tools"
        class="pointer-events-auto relative max-w-full overflow-x-auto"
      >
        <Toolbar.Group>
          <For each={tools}>
            {(tool) => (
              <Toolbar.Button
                label={`${tool.label} tool`}
                shortcut={tool.key}
                aria-pressed={props.tool === tool.id}
                variant={props.tool === tool.id ? 'cta' : 'ghost'}
                onClick={() => props.onTool(tool.id)}
              >
                <Dynamic component={tool.icon} />
              </Toolbar.Button>
            )}
          </For>
        </Toolbar.Group>
      </Toolbar>
    </div>
  );
}

export function CanvasHistoryControls(props: {
  state: CanvasState;
  onFocusCanvas: () => void;
}) {
  const hasHistory = () =>
    props.state.session().canUndo || props.state.session().canRedo;
  return (
    <Show when={hasHistory()}>
      <div class="flex items-center" role="group" aria-label="Canvas history">
        <Button
          size="icon-xs"
          label="Undo"
          hotkey={TOKENS.canvas.undo}
          disabled={!props.state.session().canUndo}
          onClick={() => {
            props.state.editor.undo();
            props.onFocusCanvas();
          }}
        >
          <Undo />
        </Button>
        <Button
          size="icon-xs"
          label="Redo"
          hotkey={TOKENS.canvas.redo}
          disabled={!props.state.session().canRedo}
          onClick={() => {
            props.state.editor.redo();
            props.onFocusCanvas();
          }}
        >
          <Redo />
        </Button>
      </div>
    </Show>
  );
}

function CanvasViewCheckboxItem(
  props: ComponentProps<typeof Dropdown.CheckboxItem>
) {
  return (
    <Dropdown.CheckboxItem
      {...props}
      indicator={
        <span class="inline-flex size-3.5 shrink-0 items-center justify-center text-ink">
          <Dropdown.ItemIndicator>
            <Check class="size-3.5" />
          </Dropdown.ItemIndicator>
        </span>
      }
    />
  );
}

export function CanvasViewControls(props: {
  scale: number;
  grid: boolean;
  onGrid: (visible: boolean) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  snapMode: CanvasSnapMode;
  onSnapMode: (mode: CanvasSnapMode) => void;
}) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        label="Zoom options"
        class="gap-1.5 tabular-nums"
      >
        <output aria-label="Zoom level">
          {Math.round(props.scale * 100)}%
        </output>
        <CaretDown class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-56">
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => props.onZoom(1.2)}>
            <span class="flex-1">Zoom In</span>
            <Hotkey shortcut="cmd+plus" theme="subtle" />
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => props.onZoom(1 / 1.2)}>
            <span class="flex-1">Zoom Out</span>
            <Hotkey token={TOKENS.canvas.zoomOut} theme="subtle" />
          </Dropdown.Item>
          <Dropdown.Item onSelect={props.onFit}>
            <span class="flex-1">Zoom to fit</span>
            <Hotkey token={TOKENS.canvas.zoomFit} theme="subtle" />
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Group>
          <For each={[25, 50, 100, 200]}>
            {(percent) => (
              <CanvasViewCheckboxItem
                closeOnSelect
                checked={Math.round(props.scale * 100) === percent}
                onChange={() => props.onZoom(percent / 100 / props.scale)}
              >
                Zoom to {percent}%
              </CanvasViewCheckboxItem>
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <CanvasViewCheckboxItem checked={props.grid} onChange={props.onGrid}>
            Toggle dot grid
          </CanvasViewCheckboxItem>
        </Dropdown.Group>
        <Dropdown.Group>
          <For
            each={
              [
                { mode: 'none', label: 'No snapping' },
                { mode: 'pixel', label: 'Snap to px' },
                { mode: 'auto', label: 'Auto snapping' },
              ] as const
            }
          >
            {(option) => (
              <CanvasViewCheckboxItem
                closeOnSelect
                checked={props.snapMode === option.mode}
                onChange={() => props.onSnapMode(option.mode)}
              >
                {option.label}
              </CanvasViewCheckboxItem>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
