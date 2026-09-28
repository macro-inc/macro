import { TOKENS } from '@core/hotkey/tokens';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import Undo from '@phosphor/arrow-u-up-left.svg';
import Redo from '@phosphor/arrow-u-up-right.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import ArrowsOut from '@phosphor/arrows-out.svg';
import Browsers from '@phosphor/browsers.svg';
import Circle from '@phosphor/circle.svg';
import Cursor from '@phosphor/cursor.svg';
import File from '@phosphor/file.svg';
import Hand from '@phosphor/hand.svg';
import Image from '@phosphor/image.svg';
import LineSegment from '@phosphor/line-segment.svg';
import List from '@phosphor/list.svg';
import Minus from '@phosphor/minus.svg';
import Path from '@phosphor/path.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Sliders from '@phosphor/sliders-horizontal.svg';
import Stack from '@phosphor/stack.svg';
import Text from '@phosphor/text-t.svg';
import { Dropdown, Toolbar } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
  { id: 'connector', label: 'Connector', icon: Path, key: 'c' },
  { id: 'line', label: 'Line', icon: LineSegment, key: 'l' },
  { id: 'pencil', label: 'Pencil', icon: Pencil, key: 'p' },
  { id: 'text', label: 'Text', icon: Text, key: 't' },
] as const;

export function CanvasDrawingToolbar(props: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onInsert: (kind: 'media' | 'document' | 'embed') => void;
}) {
  return (
    <Toolbar
      size="icon-md"
      aria-label="Drawing tools"
      class="absolute left-1/2 top-4 z-20 max-w-[calc(100%-8rem)] -translate-x-1/2 overflow-x-auto"
    >
      <Toolbar.Group>
        <For each={tools}>
          {(tool) => (
            <Toolbar.Button
              label={`${tool.label} tool`}
              shortcut={tool.key}
              aria-pressed={props.tool === tool.id}
              variant={props.tool === tool.id ? 'accent' : 'ghost'}
              onClick={() => props.onTool(tool.id)}
            >
              <Dynamic component={tool.icon} />
            </Toolbar.Button>
          )}
        </For>
      </Toolbar.Group>
      <Toolbar.Divider />
      <Toolbar.Group>
        <Toolbar.Button
          label="Add media"
          onClick={() => props.onInsert('media')}
        >
          <Image />
        </Toolbar.Button>
        <Toolbar.Button
          label="Add document"
          onClick={() => props.onInsert('document')}
        >
          <File />
        </Toolbar.Button>
        <Toolbar.Button
          label="Add embed"
          onClick={() => props.onInsert('embed')}
        >
          <Browsers />
        </Toolbar.Button>
      </Toolbar.Group>
    </Toolbar>
  );
}

export function CanvasNavigationToolbar(props: {
  state: CanvasState;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onReset: () => void;
  onFocusCanvas: () => void;
  inspector: boolean;
  onInspector: () => void;
  layers: boolean;
  onLayers: () => void;
}) {
  return (
    <div class="absolute bottom-4 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-end gap-2">
      <Toolbar size="icon-md" aria-label="Canvas navigation">
        <Toolbar.Group>
          <Toolbar.Button
            label="Zoom out"
            onClick={() => props.onZoom(1 / 1.2)}
          >
            <Minus />
          </Toolbar.Button>
          <Toolbar.Button
            label="Reset zoom"
            size="sm"
            class="min-w-14 tabular-nums"
            onClick={() => props.onZoom(1 / props.state.camera().scale)}
          >
            <output aria-label="Zoom level">
              {Math.round(props.state.camera().scale * 100)}%
            </output>
          </Toolbar.Button>
          <Toolbar.Button label="Zoom in" onClick={() => props.onZoom(1.2)}>
            <Plus />
          </Toolbar.Button>
          <Toolbar.Button label="Fit scene" onClick={props.onFit}>
            <ArrowsOut />
          </Toolbar.Button>
        </Toolbar.Group>
        <Toolbar.Divider />
        <Toolbar.Group>
          <Toolbar.Button
            label="Undo"
            hotkey={TOKENS.canvas.undo}
            disabled={!props.state.session().canUndo}
            onClick={() => {
              props.state.editor.undo();
              props.onFocusCanvas();
            }}
          >
            <Undo />
          </Toolbar.Button>
          <Toolbar.Button
            label="Redo"
            hotkey={TOKENS.canvas.redo}
            disabled={!props.state.session().canRedo}
            onClick={() => {
              props.state.editor.redo();
              props.onFocusCanvas();
            }}
          >
            <Redo />
          </Toolbar.Button>
        </Toolbar.Group>
      </Toolbar>
      <Toolbar size="icon-md" aria-label="Canvas panels">
        <Toolbar.Button
          label="Shape properties"
          aria-pressed={props.inspector}
          variant={props.inspector ? 'accent' : 'ghost'}
          onClick={props.onInspector}
        >
          <Sliders />
        </Toolbar.Button>
        <Toolbar.Button
          label="Layers"
          aria-pressed={props.layers}
          variant={props.layers ? 'accent' : 'ghost'}
          onClick={props.onLayers}
        >
          <Stack />
        </Toolbar.Button>
        <Toolbar.Divider />
        <Dropdown placement="top-start">
          <Dropdown.Trigger size="icon-md" variant="ghost" label="Canvas menu">
            <List />
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Local canvas demo</Dropdown.GroupLabel>
              <Dropdown.Item onSelect={props.onReset}>
                <ArrowCounterClockwise class="size-4" />
                Reset demo
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Toolbar>
    </div>
  );
}
