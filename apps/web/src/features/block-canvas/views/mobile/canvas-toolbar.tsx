import { MobileDockButton } from '@components/app/mobile/MobileDockButton';
import { MobileDockIsland } from '@components/app/mobile/MobileDockIsland';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Paperclip from '@icon/system/regular/paperclip.svg';
import { Dropdown } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasTool } from '../../primitives/create-canvas-state';
import { CANVAS_TOOLS } from '../shared/canvas-tools';

const SHAPE_TOOLS = [
  'rectangle',
  'ellipse',
] as const satisfies readonly CanvasTool[];
const LINE_TOOLS = [
  'arrow',
  'line',
  'connector',
] as const satisfies readonly CanvasTool[];

export type CanvasToolGroupFaces = { shape: CanvasTool; line: CanvasTool };

/**
 * The tool each group button stands for: the active tool while it is one of
 * the group's, else the one that last was. The view calls this above the
 * bottom chrome, which unmounts while the keyboard is up.
 */
export function createToolGroupFaces(
  tool: () => CanvasTool
): () => CanvasToolGroupFaces {
  const face = (tools: readonly CanvasTool[]) =>
    createMemo<CanvasTool>(
      (previous) => (tools.includes(tool()) ? tool() : previous),
      tools[0]!
    );
  const shape = face(SHAPE_TOOLS);
  const line = face(LINE_TOOLS);
  return () => ({ shape: shape(), line: line() });
}

/**
 * One tool in the bar. Buttons narrow a little before the bar would overflow
 * a small phone, and never below the 40px island minimum.
 */
function ToolButton(props: {
  tool: CanvasTool;
  active: boolean;
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  expanded?: boolean;
}) {
  return (
    <MobileDockButton
      icon={CANVAS_TOOLS[props.tool].icon}
      ariaLabel={`${CANVAS_TOOLS[props.tool].label} tool`}
      active={props.active}
      aria-pressed={props.active}
      aria-expanded={props.expanded}
      aria-haspopup={props.expanded === undefined ? undefined : 'menu'}
      class="min-w-[40px] shrink aria-pressed:bg-ink/8"
      onClick={props.onClick}
    />
  );
}

/**
 * Several tools behind one button, so a phone's bar fits its width. The
 * button shows `face`, the tool last used from the group: a tap picks it, and
 * a tap while it is already picked opens the others.
 */
function ToolGroupButton(props: {
  tools: readonly CanvasTool[];
  face: CanvasTool;
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
}) {
  const [anchor, setAnchor] = createSignal<DOMRect>();
  const active = () => props.tools.includes(props.tool);
  return (
    <div class="relative flex min-w-[40px] shrink">
      <ToolButton
        tool={props.face}
        active={active()}
        expanded={!!anchor()}
        onClick={(event) => {
          if (active()) setAnchor(event.currentTarget.getBoundingClientRect());
          else props.onTool(props.face);
        }}
      />
      <CaretUp class="pointer-events-none absolute right-[4px] top-[4px] size-[8px] text-ink-extra-muted" />
      <Show when={anchor()}>
        {(rect) => (
          <Dropdown
            open
            placement="top"
            getAnchorRect={rect}
            onOpenChange={(open) => {
              if (!open) setAnchor(undefined);
            }}
          >
            <Dropdown.Content class="min-w-40">
              <Dropdown.Group>
                <For each={props.tools}>
                  {(tool) => (
                    <Dropdown.Item
                      class="min-h-[44px]"
                      onSelect={() => props.onTool(tool)}
                    >
                      <Dynamic
                        component={CANVAS_TOOLS[tool].icon}
                        class="size-5 shrink-0"
                      />
                      {CANVAS_TOOLS[tool].label}
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        )}
      </Show>
    </div>
  );
}

/**
 * The drawing tools, as an island in the bottom chrome. Where there is no
 * room to list every tool, the shapes and the lines fold into two groups.
 */
export function MobileCanvasToolbar(props: {
  everyTool: boolean;
  /** The tool each group button stands for. */
  groupFaces: CanvasToolGroupFaces;
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  attachOpen: boolean;
  onAttach: (anchor: { x: number; y: number }) => void;
}) {
  const toolButton = (tool: CanvasTool) => (
    <ToolButton
      tool={tool}
      active={props.tool === tool}
      onClick={() => props.onTool(tool)}
    />
  );
  return (
    <MobileDockIsland class="max-w-full">
      {/* Buttons narrow first; a phone too small even for that scrolls the bar. */}
      <div
        role="toolbar"
        aria-label="Drawing tools"
        class="flex min-w-0 items-center overflow-x-auto overscroll-x-contain scrollbar-hidden"
      >
        {toolButton('select')}
        {toolButton('pan')}
        <Show
          when={!props.everyTool}
          fallback={
            <For each={[...SHAPE_TOOLS, ...LINE_TOOLS]}>{toolButton}</For>
          }
        >
          <ToolGroupButton
            tools={SHAPE_TOOLS}
            face={props.groupFaces.shape}
            tool={props.tool}
            onTool={props.onTool}
          />
          <ToolGroupButton
            tools={LINE_TOOLS}
            face={props.groupFaces.line}
            tool={props.tool}
            onTool={props.onTool}
          />
        </Show>
        {toolButton('pencil')}
        {toolButton('eraser')}
        {toolButton('text')}
        <div class="mx-[2px] h-[24px] w-px shrink-0 bg-edge-divider" />
        <MobileDockButton
          icon={Paperclip}
          ariaLabel="Attach"
          aria-expanded={props.attachOpen}
          aria-haspopup="menu"
          class="min-w-[40px] shrink"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            props.onAttach({ x: rect.left + rect.width / 2, y: rect.top });
          }}
        />
      </div>
    </MobileDockIsland>
  );
}

/** Select and Hand: all a canvas that cannot be edited needs. */
export function MobileCanvasReadOnlyToolbar(props: {
  tool: 'select' | 'pan';
  onTool: (tool: 'select' | 'pan') => void;
}) {
  return (
    <MobileDockIsland>
      <div role="toolbar" aria-label="Drawing tools" class="flex items-center">
        <For each={['select', 'pan'] as const}>
          {(tool) => (
            <ToolButton
              tool={tool}
              active={props.tool === tool}
              onClick={() => props.onTool(tool)}
            />
          )}
        </For>
      </div>
    </MobileDockIsland>
  );
}
