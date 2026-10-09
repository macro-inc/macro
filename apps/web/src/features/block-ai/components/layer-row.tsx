/**
 * A row of the layers panel, as Illustrator lists it: disclosure, the
 * layer's color, the object's kind and name (renamed in place), and the
 * visibility and lock toggles. Presentational.
 */

import { isCommitKey } from '@app/features/block-fig/core/shortcuts';
import BezierCurve from '@phosphor/bezier-curve.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import ImageIcon from '@phosphor/image.svg';
import LockSimple from '@phosphor/lock-simple.svg';
import LockSimpleOpen from '@phosphor/lock-simple-open.svg';
import Selection from '@phosphor/selection.svg';
import SelectionBackground from '@phosphor/selection-background.svg';
import Shapes from '@phosphor/shapes.svg';
import Stack from '@phosphor/stack.svg';
import TextT from '@phosphor/text-t.svg';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { DropZone, LayerRow } from '../core/layers';

const ICONS: Record<string, Component<JSX.SvgSVGAttributes<SVGSVGElement>>> = {
  layer: Stack,
  group: Selection,
  clipGroup: SelectionBackground,
  path: BezierCurve,
  text: TextT,
  image: ImageIcon,
  artwork: Shapes,
};

export const ROW_HEIGHT = 26;

export function LayerRowView(props: {
  row: LayerRow;
  /** The layer's color (CSS), shown on layer rows. */
  color?: string;
  selected: boolean;
  /** Inside a selected container (a lighter tint). */
  inSelection: boolean;
  expanded: boolean;
  renaming: boolean;
  editable: boolean;
  drop?: DropZone;
  onToggle: () => void;
  onClick: (e: MouseEvent) => void;
  onRename: (name: string | undefined) => void;
  onStartRename: () => void;
  onHidden: () => void;
  onLocked: () => void;
  onColor?: () => void;
  onHover: (inside: boolean) => void;
  /** Drag and drop (when editable). */
  drag?: {
    onStart: (e: DragEvent) => void;
    onOver: (e: DragEvent) => void;
    onLeave: () => void;
    onDrop: (e: DragEvent) => void;
    onEnd: () => void;
  };
}) {
  const layer = () => props.row.depth === 0;
  return (
    <div
      role="treeitem"
      aria-selected={props.selected}
      aria-expanded={props.row.children > 0 ? props.expanded : undefined}
      data-testid="ai-layer-row"
      data-layer-id={props.row.id}
      data-kind={props.row.kind}
      class="group relative flex items-center gap-1 pr-1.5 text-xs"
      classList={{
        'bg-accent/20': props.selected,
        'bg-accent/5': !props.selected && props.inSelection,
        'hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-accent':
          !props.selected,
        'text-ink-muted': props.row.hidden,
        'font-medium': layer(),
      }}
      style={{
        height: `${ROW_HEIGHT}px`,
        'padding-left': `${4 + props.row.depth * 12}px`,
      }}
      draggable={props.editable && !props.renaming}
      onDragStart={(e) => props.drag?.onStart(e)}
      onDragOver={(e) => props.drag?.onOver(e)}
      onDragLeave={() => props.drag?.onLeave()}
      onDrop={(e) => {
        e.preventDefault();
        props.drag?.onDrop(e);
      }}
      onDragEnd={() => props.drag?.onEnd()}
      onPointerEnter={() => props.onHover(true)}
      onPointerLeave={() => props.onHover(false)}
      onClick={(e) => props.onClick(e)}
      onDblClick={() => props.onStartRename()}
    >
      <Show when={props.drop}>
        <div
          class="pointer-events-none absolute right-1 left-1 border-accent"
          classList={{
            'top-0 border-t-2': props.drop === 'above',
            'bottom-0 border-b-2': props.drop === 'below',
            'inset-y-0 rounded border-2': props.drop === 'inside',
          }}
        />
      </Show>
      <button
        type="button"
        tabIndex={-1}
        aria-label={props.expanded ? 'Collapse' : 'Expand'}
        data-testid="ai-layer-toggle"
        class="flex size-4 shrink-0 items-center justify-center text-ink-muted"
        classList={{ invisible: props.row.children === 0 }}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggle();
        }}
      >
        <Show when={props.expanded} fallback={<CaretRight class="size-2.5" />}>
          <CaretDown class="size-2.5" />
        </Show>
      </button>
      <Show when={layer()}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Layer color"
          title="Layer color"
          data-testid="ai-layer-color"
          class="size-2.5 shrink-0 rounded-[2px] border border-edge"
          style={{ 'background-color': props.color }}
          disabled={!props.onColor}
          onClick={(e) => {
            e.stopPropagation();
            props.onColor?.();
          }}
        />
      </Show>
      <Dynamic
        component={ICONS[props.row.kind] ?? Shapes}
        class="size-3.5 shrink-0 text-ink-muted"
      />
      <Show
        when={props.renaming}
        fallback={<span class="min-w-0 flex-1 truncate">{props.row.name}</span>}
      >
        <input
          ref={(el) => queueMicrotask(() => el.select())}
          class="min-w-0 flex-1 rounded-sm bg-input px-1 text-ink outline outline-1 outline-accent"
          data-testid="ai-layer-rename"
          value={props.row.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => props.onRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (isCommitKey(e)) e.currentTarget.blur();
            if (e.key === 'Escape') props.onRename(undefined);
          }}
        />
      </Show>
      <Show
        when={props.editable}
        fallback={
          <>
            <Show when={props.row.locked}>
              <LockSimple class="size-3 shrink-0 text-ink-muted" />
            </Show>
            <Show when={props.row.hidden}>
              <EyeSlash class="size-3 shrink-0 text-ink-muted" />
            </Show>
          </>
        }
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={props.row.locked ? 'Unlock' : 'Lock'}
          data-testid="ai-layer-lock"
          class="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
          classList={{ 'invisible group-hover:visible': !props.row.locked }}
          onClick={(e) => {
            e.stopPropagation();
            props.onLocked();
          }}
        >
          <Show
            when={props.row.locked}
            fallback={<LockSimpleOpen class="size-3" />}
          >
            <LockSimple class="size-3" />
          </Show>
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={props.row.hidden ? 'Show' : 'Hide'}
          data-testid="ai-layer-visibility"
          class="shrink-0 rounded p-0.5 text-ink-muted hover:text-ink"
          classList={{ 'invisible group-hover:visible': !props.row.hidden }}
          onClick={(e) => {
            e.stopPropagation();
            props.onHidden();
          }}
        >
          <Show when={!props.row.hidden} fallback={<EyeSlash class="size-3" />}>
            <Eye class="size-3" />
          </Show>
        </button>
      </Show>
    </div>
  );
}
