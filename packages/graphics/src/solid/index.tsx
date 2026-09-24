import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  attachCameraControls,
  type GraphicsInputOptions,
  resizeCursor,
} from '../browser';
import { corners, cssMatrix, enclosing, translation } from '../core/affine';
import { worldToScreen } from '../core/camera';
import type { GraphicsEditor } from '../core/editor';
import type { Point, ShapeItem } from '../core/model';
import { isResizeEdge, resizeHandles } from '../core/resize';
import { selectionFrame } from '../core/selection-frame';
import { isShape, isShapeKind, shapeDefinition } from '../core/shapes/registry';
import {
  defaultRenderers,
  type ItemRenderers,
  ShapeView,
} from './shape-renderers';

export {
  defaultRenderers,
  type ItemRenderers,
  type ShapeViewProps,
} from './shape-renderers';
export { EllipseView } from './shapes/ellipse';
export { RectangleView } from './shapes/rectangle';

import { drawableIds, roots, worldMatrix } from '../core/scene';

export function createGraphicsProjection(editor: GraphicsEditor) {
  const [camera, setCamera] = createSignal(editor.getCamera());
  const [document, setDocument] = createStore(editor.document);
  const [session, setSession] = createSignal(editor.getSession());
  const [preview, setPreview] = createSignal(editor.getPreview());
  onCleanup(editor.subscribeCamera(setCamera));
  onCleanup(editor.subscribeDocument((next) => setDocument(reconcile(next))));
  onCleanup(editor.subscribeSession(setSession));
  onCleanup(editor.subscribePreview(setPreview));
  return { camera, document, session, preview };
}
/** Scene paint order is independent of DOM containment; nodes retain keyed mounts. */
export function GraphicsSurface(props: {
  editor: GraphicsEditor;
  renderers?: Partial<ItemRenderers>;
  gridColor?: string;
  class?: string;
  input?: GraphicsInputOptions;
  image?: { src: string; alt: string };
}) {
  const projection = createGraphicsProjection(props.editor);
  let viewport!: HTMLDivElement;
  onMount(() =>
    onCleanup(attachCameraControls(viewport, props.editor, props.input))
  );
  const scene = () =>
    projection.session().transform?.document ?? projection.document;
  const overrides = () => projection.session().transform?.nodes ?? {};
  const selected = () => roots(scene(), projection.session().selectedIds);
  const frame = createMemo(() =>
    selectionFrame(scene(), selected(), overrides())
  );
  const screen = (p: Point) => worldToScreen(projection.camera(), p);
  const outline = (id: string) =>
    selectionFrame(scene(), [id], overrides())?.corners.map(screen) ?? [];
  const pointsAttribute = (points: readonly Point[]) =>
    points.map((p) => `${p.x},${p.y}`).join(' ');
  const handleCorners = () => {
    if (projection.session().transform) return [];
    return frame()?.corners.map(screen) ?? [];
  };
  const edgeSegment = (index: number) => {
    const points = handleCorners();
    if (points.length !== 4) return undefined;
    return { start: points[index]!, end: points[(index + 1) % 4]! };
  };
  const rotationHandle = () => {
    const points = handleCorners();
    if (points.length !== 4) return undefined;
    if (selected().length === 1 && isShape(scene().items[selected()[0]!])) {
      const [a, b, c] = [points[0]!, points[1]!, points[2]!];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Keep the normal outside the box even after a resize flips an axis.
      const direction = dy * (c.x - a.x) - dx * (c.y - a.y) > 0 ? -1 : 1;
      const offset = (16 * direction) / Math.hypot(dx, dy);
      return {
        x: (a.x + b.x) / 2 + dy * offset,
        y: (a.y + b.y) / 2 - dx * offset,
      };
    }
    const bounds = enclosing(points);
    return { x: bounds.x + bounds.width / 2, y: bounds.y - 16 };
  };
  const gridStep = () => {
    let step = 32 * projection.camera().scale;
    while (step < 16) step *= 2;
    return step;
  };
  const renderers = { ...defaultRenderers, ...props.renderers };
  const previewItem = (): ShapeItem | undefined => {
    const bounds = projection.preview();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;
    const kind = props.editor.getDrawingKind();
    return {
      id: 'preview',
      type: kind,
      placement: { parentId: scene().rootId, sortKey: 'a0' },
      transform: translation(bounds.x, bounds.y),
      geometry: shapeDefinition(kind).createGeometry(bounds),
      appearance: props.input?.appearance?.() ?? {
        fill: 'transparent',
        stroke: '#e53935',
      },
    };
  };
  return (
    <div
      ref={viewport}
      class={props.class}
      tabIndex={0}
      role="region"
      aria-label="Graphics canvas"
      style={{
        position: 'relative',
        isolation: 'isolate',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        'touch-action': 'none',
        'overscroll-behavior': 'contain',
        'user-select': 'none',
        cursor: isShapeKind(props.input?.tool?.())
          ? 'crosshair'
          : props.input?.tool?.() === 'pan'
            ? 'grab'
            : undefined,
        'background-image': `radial-gradient(circle, ${props.gridColor ?? 'currentColor'} 1px, transparent 1px)`,
        'background-size': `${gridStep()}px ${gridStep()}px`,
        'background-position': `${projection.camera().x}px ${projection.camera().y}px`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          'transform-origin': '0 0',
          'pointer-events': 'none',
          'z-index': 0,
          transform: `translate(${projection.camera().x}px, ${projection.camera().y}px) scale(${projection.camera().scale})`,
        }}
      >
        <Show when={scene().surface}>
          {(surface) => (
            <Show when={props.image}>
              {(image) => (
                <img
                  src={image().src}
                  alt={image().alt}
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: '0',
                    top: '0',
                    width: `${surface().width}px`,
                    height: `${surface().height}px`,
                    'max-width': 'none',
                    'pointer-events': 'none',
                  }}
                />
              )}
            </Show>
          )}
        </Show>
        <For each={drawableIds(scene())}>
          {(id) => {
            const initial = scene().items[id];
            if (!isShape(initial)) return null;
            const item = () => {
              const node = overrides()[id] ?? scene().items[id];
              return isShape(node) ? node : initial;
            };
            const world = () => worldMatrix(scene(), id, overrides());
            return (
              <div
                data-graphics-item={id}
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  width: `${shapeDefinition(item().type).bounds(item()).width}px`,
                  height: `${shapeDefinition(item().type).bounds(item()).height}px`,
                  'transform-origin': '0 0',
                  isolation: 'isolate',
                  transform: cssMatrix(world()),
                  'pointer-events': 'auto',
                }}
              >
                <ShapeView
                  renderers={renderers}
                  item={item()}
                  scale={
                    projection.camera().scale *
                    Math.hypot(world()[0], world()[1])
                  }
                />
              </div>
            );
          }}
        </For>
        <Show when={previewItem()}>
          {(item) => (
            <div
              data-graphics-preview
              style={{
                position: 'absolute',
                left: `${projection.preview()?.x ?? 0}px`,
                top: `${projection.preview()?.y ?? 0}px`,
                width: `${projection.preview()?.width ?? 0}px`,
                height: `${projection.preview()?.height ?? 0}px`,
                'pointer-events': 'none',
              }}
            >
              <ShapeView
                renderers={renderers}
                item={item()}
                scale={projection.camera().scale}
                preview
              />
            </div>
          )}
        </Show>
      </div>
      <svg
        aria-label="Selection overlay"
        style={{
          position: 'absolute',
          'z-index': 1,
          inset: '0',
          width: '100%',
          height: '100%',
          'pointer-events': 'none',
          overflow: 'visible',
        }}
      >
        <Show when={props.input?.tool?.() === 'select'}>
          <For
            each={selected().filter(
              (id) =>
                isShape(scene().items[id]) &&
                (selected().length > 1 || projection.session().transform)
            )}
          >
            {(id) => (
              <polygon
                points={pointsAttribute(outline(id))}
                fill="none"
                stroke="#5687ff"
                stroke-width="1"
              />
            )}
          </For>
          <Show when={!projection.session().transform && frame()}>
            {(selection) => (
              <polygon
                data-graphics-selection-bounds
                stroke-dasharray={
                  selected().length > 1 ||
                  scene().items[selected()[0]!]?.type === 'group'
                    ? '3 3'
                    : undefined
                }
                points={pointsAttribute(selection().corners.map(screen))}
                fill="transparent"
                stroke="#5687ff"
                stroke-width="1"
                style={{ 'pointer-events': 'all', cursor: 'move' }}
              />
            )}
          </Show>
          {/* Screen-space hit strips; corners are painted afterward and win overlaps. */}
          <For each={resizeHandles.filter(isResizeEdge)}>
            {(handle, index) => (
              <Show when={edgeSegment(index())}>
                {(edge) => (
                  <line
                    data-graphics-handle={handle}
                    role="img"
                    aria-label={`Resize ${handle}`}
                    x1={edge().start.x}
                    y1={edge().start.y}
                    x2={edge().end.x}
                    y2={edge().end.y}
                    stroke="transparent"
                    stroke-width="10"
                    style={{
                      'pointer-events': 'stroke',
                      cursor: resizeCursor(handle, frame()),
                    }}
                  />
                )}
              </Show>
            )}
          </For>
          <For each={resizeHandles.filter((handle) => !isResizeEdge(handle))}>
            {(handle, index) => (
              <Show when={handleCorners()[index()]}>
                {(point) => (
                  <rect
                    data-graphics-handle={handle}
                    role="img"
                    aria-label={`Resize ${handle}`}
                    x={point().x - 5}
                    y={point().y - 5}
                    width="10"
                    height="10"
                    rx="0"
                    fill="white"
                    stroke="#5687ff"
                    style={{
                      'pointer-events': 'all',
                      cursor: resizeCursor(handle, frame()),
                    }}
                  />
                )}
              </Show>
            )}
          </For>
          <Show when={rotationHandle()}>
            {(handle) => (
              <circle
                data-graphics-handle="rotate"
                role="img"
                aria-label="Rotate selection"
                cx={handle().x}
                cy={handle().y}
                r="6"
                fill="white"
                stroke="#5687ff"
                style={{ 'pointer-events': 'all', cursor: 'grab' }}
              />
            )}
          </Show>
        </Show>
        <Show when={projection.session().box}>
          {(box) => (
            <polygon
              data-graphics-selection-box
              points={pointsAttribute(corners(box()).map(screen))}
              fill="rgba(86,135,255,0.12)"
              stroke="#5687ff"
            />
          )}
        </Show>
      </svg>
    </div>
  );
}
