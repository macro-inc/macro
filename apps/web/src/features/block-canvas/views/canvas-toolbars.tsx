import { TOKENS } from '@core/hotkey/tokens';
import Undo from '@icon/system/regular/arrow-u-up-left.svg';
import Redo from '@icon/system/regular/arrow-u-up-right.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import Minus from '@icon/system/regular/minus.svg';
import Paperclip from '@icon/system/regular/paperclip.svg';
import Plus from '@icon/system/regular/plus.svg';
import { Button, Dropdown, Hotkey, Toolbar } from '@ui';
import { type ComponentProps, For, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasSnapMode } from '../core/snapping';
import type {
  CanvasState,
  CanvasTool,
} from '../primitives/create-canvas-state';
import { CANVAS_TOOLS } from './shared/canvas-tools';

const EDITING_TOOLS = [
  'select',
  'pan',
  'rectangle',
  'ellipse',
  'arrow',
  'pencil',
  'eraser',
  'text',
] as const satisfies readonly CanvasTool[];
const READ_ONLY_TOOLS = [
  'select',
  'pan',
] as const satisfies readonly CanvasTool[];

export function CanvasDrawingToolbar(props: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  readOnly?: boolean;
  onAttach?: (anchor: { x: number; y: number }) => void;
  attachOpen?: boolean;
}) {
  return (
    <div class="pointer-events-none absolute bottom-4 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2">
      <Toolbar
        size="icon-md"
        aria-label="Drawing tools"
        class="pointer-events-auto relative max-w-full overflow-x-auto"
      >
        <Toolbar.Group>
          <For each={props.readOnly ? READ_ONLY_TOOLS : EDITING_TOOLS}>
            {(id) => (
              <Toolbar.Button
                aria-label={`${CANVAS_TOOLS[id].label} tool`}
                tooltip={{
                  content: `${CANVAS_TOOLS[id].label} tool`,
                  shortcut: CANVAS_TOOLS[id].key,
                }}
                aria-pressed={props.tool === id}
                variant={props.tool === id ? 'primary' : 'ghost'}
                onClick={() => props.onTool(id)}
              >
                <Dynamic component={CANVAS_TOOLS[id].icon} class="size-4" />
              </Toolbar.Button>
            )}
          </For>
        </Toolbar.Group>
        <Show when={!props.readOnly && props.onAttach}>
          <Toolbar.Divider />
          <Toolbar.Button
            aria-label="Attach"
            tooltip={{
              content: 'Attach',
              disabled: props.attachOpen,
              shortcut: 'i',
            }}
            aria-expanded={props.attachOpen ?? false}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              props.onAttach?.({ x: rect.left + rect.width / 2, y: rect.top });
            }}
          >
            <Paperclip class="size-4" />
          </Toolbar.Button>
        </Show>
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
          variant="ghost"
          aria-label="Undo"
          tooltip={{ content: 'Undo', hotkey: TOKENS.canvas.undo }}
          size="icon-xs"
          disabled={!props.state.session().canUndo}
          onClick={() => {
            props.state.editor.undo();
            props.onFocusCanvas();
          }}
        >
          <Undo class="size-3 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
        <Button
          variant="ghost"
          aria-label="Redo"
          tooltip={{ content: 'Redo', hotkey: TOKENS.canvas.redo }}
          size="icon-xs"
          disabled={!props.state.session().canRedo}
          onClick={() => {
            props.state.editor.redo();
            props.onFocusCanvas();
          }}
        >
          <Redo class="size-3 touch:size-6 shrink-0 pointer-events-none" />
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

type CanvasZoomProps = {
  scale: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  hasSelection: boolean;
  onFitSelection: () => void;
};

function CanvasZoomMenu(props: ParentProps<CanvasZoomProps>) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        aria-label="Zoom options"
        tooltip="Zoom options"
        variant="ghost"
        size="sm"
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
            <Show when={!props.hasSelection}>
              <Hotkey token={TOKENS.canvas.zoomFit} theme="subtle" />
            </Show>
          </Dropdown.Item>
          <Dropdown.Item
            disabled={!props.hasSelection}
            onSelect={props.onFitSelection}
          >
            <span class="flex-1">Zoom to fit selection</span>
            <Show when={props.hasSelection}>
              <Hotkey token={TOKENS.canvas.zoomFit} theme="subtle" />
            </Show>
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
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}

export function CanvasZoomToolbar(props: CanvasZoomProps) {
  return (
    <div class="absolute bottom-4 left-4 z-40">
      <Toolbar size="icon-sm" aria-label="Canvas zoom">
        <Toolbar.Group>
          <Toolbar.Button
            aria-label="Zoom out"
            tooltip="Zoom out"
            onClick={() => props.onZoom(1 / 1.2)}
          >
            <Minus class="size-4" />
          </Toolbar.Button>
          <CanvasZoomMenu {...props} />
          <Toolbar.Button
            aria-label="Zoom in"
            tooltip="Zoom in"
            onClick={() => props.onZoom(1.2)}
          >
            <Plus class="size-4" />
          </Toolbar.Button>
        </Toolbar.Group>
      </Toolbar>
    </div>
  );
}

export function CanvasViewControls(
  props: CanvasZoomProps & {
    grid: boolean;
    onGrid: (visible: boolean) => void;
    snapMode: CanvasSnapMode;
    onSnapMode: (mode: CanvasSnapMode) => void;
    snapToObjects: boolean;
    onSnapToObjects: (enabled: boolean) => void;
  }
) {
  return (
    <CanvasZoomMenu
      scale={props.scale}
      onZoom={props.onZoom}
      onFit={props.onFit}
      hasSelection={props.hasSelection}
      onFitSelection={props.onFitSelection}
    >
      <Dropdown.Group>
        <CanvasViewCheckboxItem checked={props.grid} onChange={props.onGrid}>
          Toggle dot grid
        </CanvasViewCheckboxItem>
      </Dropdown.Group>
      <Dropdown.Group>
        <CanvasViewCheckboxItem
          checked={props.snapToObjects}
          onChange={props.onSnapToObjects}
        >
          Snap to objects
        </CanvasViewCheckboxItem>
      </Dropdown.Group>
      <Dropdown.Group>
        <For
          each={
            [
              { mode: 'none', label: 'No grid snapping' },
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
    </CanvasZoomMenu>
  );
}
