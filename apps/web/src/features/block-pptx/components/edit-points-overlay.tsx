/**
 * Edit Points on the stage, as in PowerPoint: the outline as a red path
 * with black square vertices; the selected vertex shows its Bézier handles
 * as white squares. Drag a vertex to move it, a handle to reshape its
 * curves, or a segment to bend it; Ctrl/Cmd+click a segment adds a point
 * and Ctrl/Cmd+click a vertex deletes it. Right-click for Add/Delete Point,
 * Open/Close Path, Smooth/Straight/Corner Point, Straight/Curved Segment,
 * and Exit Edit Points. Esc or a click away from the outline leaves.
 */

import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  addNode,
  allNodes,
  bendSegment,
  closeSubpath,
  deleteNode,
  deleteSegment,
  type EditShape,
  type HandleSide,
  handles,
  hitHandle,
  hitNode,
  hitSegment,
  isClosed,
  isCurved,
  moveHandle,
  moveNode,
  type NodeKind,
  type NodeRef,
  nodeAt,
  openAt,
  pathData,
  type SegmentRef,
  sameShape,
  setNodeKind,
  setSegmentCurved,
} from '../core/edit-points';
import {
  type Affine,
  applyAffine,
  invertAffine,
  type Point,
} from '../core/geometry';
import type { EditPoints } from '../primitives/create-edit-points';

/** Vertex and handle squares, and hit radii (CSS pixels). */
const VERTEX = 7;
const HANDLE = 7;
const HIT_VERTEX = 7;
const HIT_SEGMENT = 5;
const DRAG_THRESHOLD = 3;
/** PowerPoint's edit-points red and handle gray. */
const RED = '#c00000';
const INK = '#3c3c3c';

type Gesture =
  | { kind: 'node'; ref: NodeRef; start: EditShape; from: Point; at: Point }
  | {
      kind: 'handle';
      ref: NodeRef;
      side: HandleSide;
      start: EditShape;
      from: Point;
      at: Point;
    }
  | {
      kind: 'segment';
      ref: SegmentRef;
      t: number;
      start: EditShape;
      at: Point;
    };

/** What a right-click landed on. */
type MenuTarget =
  | { kind: 'node'; ref: NodeRef }
  | { kind: 'segment'; ref: SegmentRef; t: number }
  | { kind: 'none' };

export function EditPointsOverlay(props: {
  points: EditPoints;
  /** CSS pixels per point. */
  scale: number;
}) {
  const ep = props.points;
  let root!: HTMLDivElement;

  /** Shape-local points → stage pixels. */
  const toScreen = (): Affine => {
    const t = ep.info()?.transform ?? [1, 0, 0, 1, 0, 0];
    const k = props.scale;
    return [t[0] * k, t[1] * k, t[2] * k, t[3] * k, t[4] * k, t[5] * k];
  };
  const toLocal = (p: Point): Point => {
    const inv = invertAffine(toScreen());
    return inv ? applyAffine(inv, p) : p;
  };
  const screenAt = (e: { clientX: number; clientY: number }): Point => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ---- pointer -------------------------------------------------------------

  let gesture: Gesture | null = null;
  let moved = false;
  let downAt: Point = { x: 0, y: 0 };
  const [cursor, setCursor] = createSignal<string>('default');

  const hits = (at: Point) => {
    const shape = ep.model();
    if (!shape) return {};
    const selected = ep.selected();
    const handle =
      selected && hitHandle(shape, selected, toScreen(), at, HIT_VERTEX);
    const node = hitNode(shape, toScreen(), at, HIT_VERTEX);
    const segment = node
      ? undefined
      : hitSegment(shape, toScreen(), at, HIT_SEGMENT);
    return { shape, selected, handle, node, segment };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const at = screenAt(e);
    const { shape, selected, handle, node, segment } = hits(at);
    if (!shape) return;
    const local = toLocal(at);
    const mod = e.ctrlKey || e.metaKey;
    moved = false;
    downAt = at;
    if (selected && handle) {
      const h = handles(
        shape[selected.path].subpaths[selected.sub],
        selected.node
      ).find((x) => x.side === handle);
      gesture = {
        kind: 'handle',
        ref: selected,
        side: handle,
        start: shape,
        from: h?.at ?? local,
        at: local,
      };
    } else if (node) {
      if (mod) {
        const next = deleteNode(shape, node);
        if (next) void ep.commit(next, null);
        return;
      }
      ep.select(node);
      gesture = {
        kind: 'node',
        ref: node,
        start: shape,
        from: nodeAt(shape, node)?.p ?? local,
        at: local,
      };
    } else if (segment) {
      if (mod) {
        const added = addNode(shape, segment.ref, segment.t);
        void ep.commit(added.shape, added.node);
        return;
      }
      gesture = {
        kind: 'segment',
        ref: segment.ref,
        t: segment.t,
        start: shape,
        at: local,
      };
    } else {
      ep.exit();
      return;
    }
    ep.beginDrag();
    root.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const at = screenAt(e);
    const g = gesture;
    if (!g) {
      const { handle, node, segment } = hits(at);
      setCursor(handle || node ? 'move' : segment ? 'crosshair' : 'default');
      return;
    }
    if (!moved && Math.hypot(at.x - downAt.x, at.y - downAt.y) < DRAG_THRESHOLD)
      return;
    moved = true;
    const local = toLocal(at);
    const d = { x: local.x - g.at.x, y: local.y - g.at.y };
    if (g.kind === 'node')
      ep.preview(
        moveNode(g.start, g.ref, { x: g.from.x + d.x, y: g.from.y + d.y })
      );
    else if (g.kind === 'handle')
      ep.preview(
        moveHandle(g.start, g.ref, g.side, {
          x: g.from.x + d.x,
          y: g.from.y + d.y,
        })
      );
    else ep.preview(bendSegment(g.start, g.ref, g.t, d));
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = gesture;
    gesture = null;
    if (root.hasPointerCapture(e.pointerId))
      root.releasePointerCapture(e.pointerId);
    if (!g) return;
    const now = ep.model();
    const changed = moved && now && !sameShape(now, g.start) ? now : null;
    void ep.endDrag(changed);
  };

  const onPointerCancel = (e: PointerEvent) => {
    const g = gesture;
    gesture = null;
    if (root.hasPointerCapture(e.pointerId))
      root.releasePointerCapture(e.pointerId);
    if (g) {
      ep.preview(g.start);
      void ep.endDrag(null);
    }
  };

  // ---- right-click ---------------------------------------------------------

  const [menu, setMenu] = createSignal<MenuTarget>({ kind: 'none' });
  const onContextMenu = (e: MouseEvent) => {
    const { node, segment } = hits(screenAt(e));
    if (node) {
      ep.select(node);
      setMenu({ kind: 'node', ref: node });
    } else if (segment) setMenu({ kind: 'segment', ...segment });
    else setMenu({ kind: 'none' });
  };
  const run = (edit: (shape: EditShape) => EditShape | null) => {
    const shape = ep.model();
    if (!shape) return;
    const next = edit(shape);
    if (next && !sameShape(next, shape)) void ep.commit(next);
  };
  const kindItem = (ref: NodeRef, kind: NodeKind, text: string) => (
    <MenuItem
      text={text}
      selectorType="checkbox"
      closeOnSelect
      checked={nodeAt(ep.model() ?? [], ref)?.kind === kind}
      onClick={() => {
        const shape = ep.model();
        if (!shape) return;
        const next = setNodeKind(shape, ref, kind);
        // The kind alone may change (a corner whose handles already line up).
        void ep.commit(next);
      }}
    />
  );
  const pathItem = (ref: { path: number; sub: number }, open: () => void) => (
    <Show
      when={isClosed(ep.model() ?? [], ref)}
      fallback={
        <MenuItem
          text="Close Path"
          onClick={() => run((s) => closeSubpath(s, ref))}
        />
      }
    >
      <MenuItem text="Open Path" onClick={open} />
    </Show>
  );

  // ---- keyboard and clicks elsewhere ---------------------------------------

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // An open menu takes its own keys (Escape closes just the menu).
      if (!ep.active() || document.querySelector('[role="menu"]')) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        ep.exit();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        void (key === 'y' || e.shiftKey ? ep.redo() : ep.undo());
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Deletes the selected point, never the shape.
        e.preventDefault();
        e.stopPropagation();
        const selected = ep.selected();
        const shape = ep.model();
        const next = selected && shape && deleteNode(shape, selected);
        if (next) void ep.commit(next, null);
        return;
      }
      if (e.key.startsWith('Arrow') || e.key === 'Tab') {
        // The shape stays put while its points are edited.
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onDocumentPointerDown = (e: PointerEvent) => {
      if (!ep.active()) return;
      const target = e.target as HTMLElement | null;
      if (!target || root.contains(target)) return;
      // The menu's own items, and the ribbon's Edit Points command.
      if (target.closest('[role="menu"],[data-pptx-edit-points-toggle]'))
        return;
      ep.exit();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    });
  });

  // ---- drawing -------------------------------------------------------------

  const selectedHandles = () => {
    const shape = ep.model();
    const ref = ep.selected();
    const s = ref && shape?.[ref.path]?.subpaths[ref.sub];
    if (!ref || !s || ref.node >= s.nodes.length) return [];
    const p = applyAffine(toScreen(), s.nodes[ref.node].p);
    return handles(s, ref.node).map((h) => ({
      side: h.side,
      from: p,
      at: applyAffine(toScreen(), h.at),
    }));
  };
  const isSelected = (ref: NodeRef) => {
    const s = ep.selected();
    return (
      !!s && s.path === ref.path && s.sub === ref.sub && s.node === ref.node
    );
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="div"
        ref={root}
        data-testid="pptx-edit-points-overlay"
        class="absolute inset-0 touch-none select-none"
        style={{ cursor: cursor() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        oncapture:contextmenu={onContextMenu}
      >
        <Show when={ep.model()}>
          {(shape) => (
            <svg
              class="pointer-events-none absolute inset-0 size-full overflow-visible"
              aria-hidden="true"
            >
              <path
                data-testid="pptx-edit-points-path"
                d={pathData(shape(), toScreen())}
                fill="none"
                stroke={RED}
                stroke-width={1.25}
                stroke-linejoin="round"
              />
              <For each={selectedHandles()}>
                {(h) => (
                  <>
                    <line
                      x1={h.from.x}
                      y1={h.from.y}
                      x2={h.at.x}
                      y2={h.at.y}
                      stroke={INK}
                      stroke-width={1}
                    />
                    <rect
                      data-testid={`pptx-edit-points-handle-${h.side}`}
                      x={h.at.x - HANDLE / 2}
                      y={h.at.y - HANDLE / 2}
                      width={HANDLE}
                      height={HANDLE}
                      fill="#fff"
                      stroke={INK}
                      stroke-width={1}
                    />
                  </>
                )}
              </For>
              <For each={allNodes(shape())}>
                {(n) => {
                  const p = () => applyAffine(toScreen(), n.p);
                  return (
                    <rect
                      data-testid="pptx-edit-point"
                      data-selected={isSelected(n.ref) || undefined}
                      x={p().x - VERTEX / 2}
                      y={p().y - VERTEX / 2}
                      width={VERTEX}
                      height={VERTEX}
                      fill="#000"
                      stroke="#fff"
                      stroke-width={isSelected(n.ref) ? 1.5 : 0.75}
                    />
                  );
                }}
              </For>
            </svg>
          )}
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="w-56">
          <Switch>
            <Match
              when={(() => {
                const m = menu();
                return m.kind === 'node' ? m : undefined;
              })()}
            >
              {(m) => (
                <>
                  <MenuItem
                    text="Delete Point"
                    onClick={() => {
                      const shape = ep.model();
                      const next = shape && deleteNode(shape, m().ref);
                      if (next) void ep.commit(next, null);
                    }}
                  />
                  {pathItem(m().ref, () => run((s) => openAt(s, m().ref)))}
                  <MenuSeparator />
                  {kindItem(m().ref, 'smooth', 'Smooth Point')}
                  {kindItem(m().ref, 'straight', 'Straight Point')}
                  {kindItem(m().ref, 'corner', 'Corner Point')}
                </>
              )}
            </Match>
            <Match
              when={(() => {
                const m = menu();
                return m.kind === 'segment' ? m : undefined;
              })()}
            >
              {(m) => (
                <>
                  <MenuItem
                    text="Add Point"
                    onClick={() => {
                      const shape = ep.model();
                      if (!shape) return;
                      const added = addNode(shape, m().ref, m().t);
                      void ep.commit(added.shape, added.node);
                    }}
                  />
                  <MenuItem
                    text="Delete Segment"
                    onClick={() => run((s) => deleteSegment(s, m().ref))}
                  />
                  {pathItem(m().ref, () =>
                    run((s) => {
                      // Open where the segment was clicked.
                      const added = addNode(s, m().ref, m().t);
                      return openAt(added.shape, added.node);
                    })
                  )}
                  <MenuSeparator />
                  <MenuItem
                    text="Straight Segment"
                    selectorType="checkbox"
                    closeOnSelect
                    checked={!isCurved(ep.model() ?? [], m().ref)}
                    onClick={() =>
                      run((s) => setSegmentCurved(s, m().ref, false))
                    }
                  />
                  <MenuItem
                    text="Curved Segment"
                    selectorType="checkbox"
                    closeOnSelect
                    checked={isCurved(ep.model() ?? [], m().ref)}
                    onClick={() =>
                      run((s) => setSegmentCurved(s, m().ref, true))
                    }
                  />
                </>
              )}
            </Match>
          </Switch>
          <Show when={menu().kind !== 'none'}>
            <MenuSeparator />
          </Show>
          <MenuItem text="Exit Edit Points" onClick={() => ep.exit()} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
