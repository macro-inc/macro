/** Figma's compact, grouped drawing tools in a single floating strip. */
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Circle from '@phosphor/circle.svg';
import Code from '@phosphor/code.svg';
import Hand from '@phosphor/hand.svg';
import Hash from '@phosphor/hash.svg';
import LineSegment from '@phosphor/line-segment.svg';
import NavigationArrow from '@phosphor/navigation-arrow.svg';
import PenNib from '@phosphor/pen-nib.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Shapes from '@phosphor/shapes.svg';
import Square from '@phosphor/square.svg';
import TextT from '@phosphor/text-t.svg';
import { createMemo, For, type JSX, Show } from 'solid-js';
import type { Tool } from '../primitives/create-fig-viewer';
import { EditorMenu } from './editor-menu';

export type { EditorMenuItem as ZoomMenuItem } from './editor-menu';

interface ToolButton {
  tool: Tool;
  label: string;
  key: string;
  icon: (props: { class?: string }) => JSX.Element;
}

const GROUPS: { label: string; edit?: boolean; tools: ToolButton[] }[] = [
  {
    label: 'Move tools',
    tools: [
      { tool: 'move', label: 'Move', key: 'V', icon: NavigationArrow },
      { tool: 'hand', label: 'Hand tool', key: 'H', icon: Hand },
    ],
  },
  {
    label: 'Frame tools',
    edit: true,
    tools: [{ tool: 'frame', label: 'Frame', key: 'F', icon: Hash }],
  },
  {
    label: 'Shape tools',
    edit: true,
    tools: [
      { tool: 'rectangle', label: 'Rectangle', key: 'R', icon: Square },
      { tool: 'line', label: 'Line', key: 'L', icon: LineSegment },
      { tool: 'arrow', label: 'Arrow', key: '⇧L', icon: ArrowUpRight },
      { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
    ],
  },
  {
    label: 'Drawing tools',
    edit: true,
    tools: [
      { tool: 'pen', label: 'Pen', key: 'P', icon: PenNib },
      { tool: 'pencil', label: 'Pencil', key: '⇧P', icon: PencilSimple },
    ],
  },
  {
    label: 'Text tools',
    edit: true,
    tools: [{ tool: 'text', label: 'Text', key: 'T', icon: TextT }],
  },
];

function ToolGroup(props: {
  label: string;
  tools: ToolButton[];
  tool: Tool | undefined;
  onTool: (tool: Tool) => void;
}) {
  // Retain the last tool used in each group, including shortcut selections.
  const current = createMemo<ToolButton>(
    (previous) =>
      props.tools.find((t) => t.tool === props.tool) ??
      previous ??
      props.tools[0]
  );
  return (
    <div class="flex shrink-0 items-center gap-px">
      <button
        type="button"
        aria-label={`${current().label} (${current().key})`}
        title={`${current().label} · ${current().key}`}
        aria-pressed={props.tool === current().tool}
        data-testid={`fig-tool-${current().tool}`}
        class="flex size-8 items-center justify-center rounded-lg text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-accent aria-pressed:text-accent-contrast"
        onClick={() => props.onTool(current().tool)}
      >
        {current().icon({ class: 'size-4' })}
      </button>
      <Show when={props.tools.length > 1}>
        <EditorMenu
          label={props.label}
          testId={`fig-tool-menu-${props.tools[0].tool}`}
          above
          items={props.tools.map((t) => ({
            label: t.label,
            shortcut: t.key,
            icon: t.icon({ class: 'size-4' }),
            checked: props.tool === t.tool,
            testId: `fig-choose-${t.tool}`,
            onSelect: () => props.onTool(t.tool),
          }))}
        >
          <CaretDown class="size-2.5" />
        </EditorMenu>
      </Show>
    </div>
  );
}

export function ViewerToolbar(props: {
  tool: Tool | undefined;
  onTool: (tool: Tool) => void;
  editable?: boolean;
  onActions: () => void;
  devMode: boolean;
  onDevMode: () => void;
  review?: JSX.Element;
}) {
  return (
    <div
      class="-translate-x-1/2 absolute bottom-4 left-1/2 z-10 flex w-max max-w-[calc(100%-1rem)] items-center gap-1 rounded-2xl border border-edge-muted bg-menu p-2 shadow-lg"
      data-testid="fig-toolbar"
      aria-label="Drawing tools"
      role="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <For each={GROUPS.filter((g) => props.editable || !g.edit)}>
        {(group) => (
          <ToolGroup {...group} tool={props.tool} onTool={props.onTool} />
        )}
      </For>
      {props.review}
      <button
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Actions"
        title="Actions · ⌘/ / Ctrl+/"
        data-testid="fig-actions-button"
        onClick={props.onActions}
      >
        <Shapes class="size-4" />
      </button>
      <div aria-hidden="true" class="mx-1 h-5 w-px shrink-0 bg-edge-muted" />
      <button
        type="button"
        aria-label="Dev Mode"
        aria-pressed={props.devMode}
        title="Dev Mode"
        data-testid="fig-panel-tab-code"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-inset px-2 text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-success aria-pressed:text-accent-contrast"
        onClick={props.onDevMode}
      >
        <Code class="size-4" />
      </button>
    </div>
  );
}
