import {
  type Component,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { attachCameraControls, type GraphicsInputOptions } from '../browser';
import { corners, cssMatrix, enclosing } from '../core/affine';
import { worldToScreen } from '../core/camera';
import type { GraphicsEditor } from '../core/editor';
import type { Point, RectangleItem } from '../core/model';
import {
  drawableIds,
  nodeCorners,
  roots,
  worldBounds,
  worldMatrix,
} from '../core/scene';

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
export type ItemRenderers = {
  rectangle: Component<{ item: RectangleItem; scale: number }>;
};
export const RectangleView: Component<{ item: RectangleItem }> = (props) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      'box-sizing': 'border-box',
      background: props.item.appearance.fill,
      border: `2px solid ${props.item.appearance.stroke}`,
    }}
  />
);

/** Scene paint order is independent of DOM containment; nodes retain keyed mounts. */
export function GraphicsSurface(props: {
  editor: GraphicsEditor;
  renderers?: ItemRenderers;
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
  const overrides = () => projection.session().transform?.nodes ?? {};
  const selected = () =>
    roots(projection.document, projection.session().selectedIds);
  const screen = (p: Point) => worldToScreen(projection.camera(), p);
  const outline = (id: string) => {
    const node = projection.document.items[id];
    const points =
      node?.type === 'rectangle'
        ? nodeCorners(projection.document, id, overrides())
        : corners(worldBounds(projection.document, id, overrides()));
    return points.map(screen);
  };
  const pointsAttribute = (points: readonly Point[]) =>
    points.map((p) => `${p.x},${p.y}`).join(' ');
  const handlePoints = () => {
    if (projection.session().transform) return [];
    if (
      selected().length > 1 ||
      projection.document.items[projection.session().selectedId ?? '']?.type ===
        'group'
    ) {
      const bounds = selectionBounds();
      return bounds ? corners(bounds) : [];
    }
    const id = projection.session().selectedId;
    return id && projection.document.items[id]?.type === 'rectangle'
      ? outline(id)
      : [];
  };
  const selectionBounds = () => {
    const points = selected()
      .flatMap((id) => nodeCorners(projection.document, id, overrides()))
      .map(screen);
    if (!points.length) return undefined;
    return enclosing(points);
  };
  const rotationHandle = () => {
    if (projection.session().transform) return undefined;
    const b = selectionBounds();
    return b ? { x: b.x + b.width / 2, y: b.y - 30, anchorY: b.y } : undefined;
  };
  const gridStep = () => {
    let step = 32 * projection.camera().scale;
    while (step < 16) step *= 2;
    return step;
  };
  const Rectangle = props.renderers?.rectangle ?? RectangleView;
  return (
    <div
      ref={viewport}
      class={props.class}
      tabIndex={0}
      role="region"
      aria-label="Graphics canvas"
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        'touch-action': 'none',
        'overscroll-behavior': 'contain',
        'user-select': 'none',
        cursor:
          props.input?.tool?.() === 'rectangle'
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
          transform: `translate(${projection.camera().x}px, ${projection.camera().y}px) scale(${projection.camera().scale})`,
        }}
      >
        <Show when={projection.document.surface}>
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
        <For each={drawableIds(projection.document)}>
          {(id) => {
            const initial = projection.document.items[id];
            if (initial?.type !== 'rectangle') return null;
            const item = () => {
              const node = overrides()[id] ?? projection.document.items[id];
              return node?.type === 'rectangle' ? node : initial;
            };
            const world = () =>
              worldMatrix(projection.document, id, overrides());
            return (
              <div
                data-graphics-item={id}
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  width: `${item().geometry.width}px`,
                  height: `${item().geometry.height}px`,
                  'transform-origin': '0 0',
                  transform: cssMatrix(world()),
                  'pointer-events': 'auto',
                }}
              >
                <Rectangle
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
        <Show when={projection.preview()}>
          {(preview) => (
            <div
              data-graphics-preview
              style={{
                position: 'absolute',
                left: `${preview().x}px`,
                top: `${preview().y}px`,
                width: `${preview().width}px`,
                height: `${preview().height}px`,
                'box-sizing': 'border-box',
                border: `${2 / projection.camera().scale}px dashed ${props.input?.appearance?.().stroke ?? '#e53935'}`,
                'pointer-events': 'none',
              }}
            />
          )}
        </Show>
      </div>
      <svg
        aria-label="Selection overlay"
        style={{
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          'pointer-events': 'none',
          overflow: 'visible',
        }}
      >
        <Show when={props.input?.tool?.() === 'select'}>
          <For each={selected()}>
            {(id) => (
              <polygon
                points={pointsAttribute(outline(id))}
                fill="none"
                stroke="#5687ff"
                stroke-width="2"
              />
            )}
          </For>
          <Show
            when={
              !projection.session().transform &&
              selected().length > 1 &&
              selectionBounds()
            }
          >
            {(bounds) => (
              <rect
                data-graphics-selection-bounds
                stroke-dasharray="3 3"
                x={bounds().x}
                y={bounds().y}
                width={bounds().width}
                height={bounds().height}
                fill="none"
                stroke="#5687ff"
                stroke-width="1"
              />
            )}
          </Show>
          <For each={['nw', 'ne', 'se', 'sw'] as const}>
            {(corner, index) => (
              <Show when={handlePoints()[index()]}>
                {(point) => (
                  <rect
                    data-graphics-handle={corner}
                    role="img"
                    aria-label={`Resize ${corner}`}
                    x={point().x - 5}
                    y={point().y - 5}
                    width="10"
                    height="10"
                    rx="2"
                    fill="white"
                    stroke="#5687ff"
                    style={{
                      'pointer-events': 'all',
                      cursor:
                        corner === 'nw' || corner === 'se'
                          ? 'nwse-resize'
                          : 'nesw-resize',
                    }}
                  />
                )}
              </Show>
            )}
          </For>
          <Show when={rotationHandle()}>
            {(handle) => (
              <>
                <line
                  x1={handle().x}
                  y1={handle().anchorY}
                  x2={handle().x}
                  y2={handle().y}
                  stroke="#5687ff"
                />
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
              </>
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
