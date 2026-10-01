import {
  batch,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  attachCameraControls,
  type GraphicsHover,
  type GraphicsInputOptions,
  resizeCursor,
} from '../browser';
import { selectionTarget } from '../browser/selection-target';
import {
  corners,
  cssMatrix,
  enclosing,
  IDENTITY,
  transformPoint,
} from '../core/affine';
import { screenToWorld, worldToScreen } from '../core/camera';
import { connectorWorldView } from '../core/connectors';
import type { GraphicsEditor } from '../core/editor';
import type { GraphicsDocument, Point, ShapeItem } from '../core/model';
import { isRadiusHandle } from '../core/radius';
import { isResizeEdge, resizeHandles } from '../core/resize';
import { selectionFrame } from '../core/selection-frame';
import { isShape, isShapeKind, shapeDefinition } from '../core/shapes/registry';
import { selectedShapeIds } from '../core/style-selection';
import { createShapeView } from './create-shape-view';
import { DotGrid } from './dot-grid-view';
import { RadiusHandles } from './radius-handles';
import { ShapeSelectionOutline } from './selection-outline';
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
export { TextView } from './shapes/text';

import {
  drawableIds,
  resolvedShape,
  roots,
  type SceneOverrides,
  shapeProjection,
  worldMatrix,
} from '../core/scene';

export function createGraphicsProjection(editor: GraphicsEditor) {
  const [camera, setCamera] = createSignal(editor.getCamera());
  const [document, setDocument] = createStore(editor.document);
  // Core geometry caches rely on immutable identities. The store is still useful
  // for fine-grained UI reads, but unwraps frozen geometries into mutable proxies.
  const [snapshot, setSnapshot] = createSignal(editor.document);
  const [session, setSession] = createSignal(editor.getSession());
  const [preview, setPreview] = createSignal(editor.getPreview());
  onCleanup(editor.subscribeCamera(setCamera));
  onCleanup(
    editor.subscribeDocument((next) =>
      batch(() => {
        setDocument(reconcile(next));
        setSnapshot(next);
      })
    )
  );
  onCleanup(editor.subscribeSession(setSession));
  onCleanup(editor.subscribePreview(setPreview));
  return { camera, document, snapshot, session, preview };
}
/** Scene paint order is independent of DOM containment; nodes retain keyed mounts. */
export function GraphicsSurface(props: {
  editor: GraphicsEditor;
  renderers?: Partial<ItemRenderers>;
  gridColor?: string;
  class?: string;
  input?: GraphicsInputOptions;
  image?: { src: string; alt: string };
  children?: JSX.Element;
  hideSelection?: boolean;
  /** Allow interactive shape content to receive clicks through the selection box. */
  selectionHitArea?: 'bounds' | 'shapes';
  /** Optional browser feature controls, disposed with the actual viewport. */
  attachControls?: (element: HTMLElement) => () => void;
  /** A feature-owned draft scene. It never replaces the editor document/history. */
  documentPreview?: GraphicsDocument;
}) {
  const projection = createGraphicsProjection(props.editor);
  const [hover, setHover] = createSignal<GraphicsHover>();
  let viewport!: HTMLDivElement;
  onMount(() => {
    onCleanup(
      attachCameraControls(viewport, props.editor, {
        ...props.input,
        onHover: (next) => {
          setHover(next);
          props.input?.onHover?.(next);
        },
      })
    );
    if (props.attachControls) onCleanup(props.attachControls(viewport));
  });
  const scene = createMemo(
    () =>
      props.documentPreview ??
      projection.session().transform?.document ??
      projection.snapshot()
  );
  const emptyOverrides: SceneOverrides = Object.freeze({});
  const overrides = createMemo(
    () => projection.session().transform?.nodes ?? emptyOverrides
  );
  const cameraScale = createMemo(() => projection.camera().scale);
  const selected = createMemo(
    () => roots(scene(), projection.session().selectedIds),
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    }
  );
  const selectedShapes = createMemo(() =>
    selectedShapeIds(scene(), selected())
  );
  const moving = createMemo(
    () => projection.session().transform?.kind === 'move'
  );
  const movingShapes = createMemo(
    () => new Set(moving() ? selectedShapes() : [])
  );
  const contentOverrides = createMemo(() =>
    moving() ? emptyOverrides : overrides()
  );
  // Every selected root receives the same world-space translation. Keep the
  // flat paint order, including unselected shapes between moving ones.
  const moveOffset = createMemo(() => {
    const id = selected()[0];
    if (!moving() || !id) return { x: 0, y: 0 };
    const base = worldMatrix(scene(), id);
    const next = worldMatrix(scene(), id, overrides());
    return { x: next[4] - base[4], y: next[5] - base[5] };
  });
  const moveElements = new Map<string, Set<HTMLElement | SVGElement>>();
  let translatedElements = new Set<HTMLElement | SVGElement>();
  const registerMoveElement = (
    id: string,
    element: HTMLElement | SVGElement
  ) => {
    const elements =
      moveElements.get(id) ?? new Set<HTMLElement | SVGElement>();
    elements.add(element);
    moveElements.set(id, elements);
    untrack(() => {
      if (movingShapes().has(id) && scene().items[id]?.type !== 'connector') {
        const offset = moveOffset();
        element.style.translate = `${offset.x}px ${offset.y}px`;
        translatedElements.add(element);
      }
    });
    onCleanup(() => {
      elements.delete(element);
      if (!elements.size) moveElements.delete(id);
      translatedElements.delete(element);
    });
  };
  // Update only the moving wrappers and outlines. Inherited CSS variables would
  // invalidate styles throughout the scene, including every embedded subtree.
  createRenderEffect(() => {
    const offset = moveOffset();
    const translate = `${offset.x}px ${offset.y}px`;
    const next = new Set<HTMLElement | SVGElement>();
    for (const id of movingShapes()) {
      if (scene().items[id]?.type === 'connector') continue;
      for (const element of moveElements.get(id) ?? []) {
        element.style.translate = translate;
        next.add(element);
      }
    }
    for (const element of translatedElements) {
      if (!next.has(element)) element.style.removeProperty('translate');
    }
    translatedElements = next;
  });
  const hoveredShapes = createMemo(() => {
    const pointer = hover();
    if (
      !pointer ||
      props.input?.tool?.() !== 'select' ||
      projection.session().transform ||
      projection.session().box ||
      projection.preview()
    )
      return [];
    const camera = projection.camera();
    const id = selectionTarget(
      projection.snapshot(),
      projection.session().selectedIds,
      screenToWorld(camera, pointer.point),
      { ...pointer, tolerance: 3 / camera.scale }
    );
    return id ? selectedShapeIds(projection.snapshot(), [id]) : [];
  });
  const indicatedShapes = createMemo(() => [
    ...new Set([...selectedShapes(), ...hoveredShapes()]),
  ]);
  const singleConnector = () => {
    if (selected().length !== 1) return;
    const item = resolvedShape(scene(), selected()[0]!, overrides());
    return item?.type === 'connector' ? item : undefined;
  };
  const frame = createMemo(() =>
    projection.session().transform
      ? undefined
      : selectionFrame(scene(), selected())
  );
  const radiusRectangle = () => {
    const gesture = projection.session().transform;
    if (
      selected().length !== 1 ||
      props.input?.tool?.() !== 'select' ||
      props.input?.suspended?.() ||
      (gesture && gesture.kind !== 'radius')
    )
      return;
    const item = overrides()[selected()[0]!] ?? scene().items[selected()[0]!];
    return item?.type === 'rectangle' ? item : undefined;
  };
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
  const renderers = { ...defaultRenderers, ...props.renderers };
  const previewItem = (): ShapeItem | undefined => {
    if (!projection.preview()) return undefined;
    return props.editor.getDrawingPreview(
      props.input?.appearance?.() ?? {
        fill: 'transparent',
        stroke: '#e53935',
      }
    );
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
      }}
    >
      <DotGrid
        camera={projection.camera()}
        color={props.gridColor ?? 'currentColor'}
      />
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
            const isConnector = () => scene().items[id]?.type === 'connector';
            // Connectors can change their routes when either bound end moves.
            const shapeOverrides = () =>
              isConnector() ? overrides() : contentOverrides();
            const item = createMemo(
              () => resolvedShape(scene(), id, shapeOverrides()) ?? initial
            );
            const world = createMemo(
              () => worldMatrix(scene(), id, shapeOverrides()),
              undefined,
              {
                equals: (a, b) =>
                  a.length === b.length &&
                  a.every((value, i) => value === b[i]),
              }
            );
            const boundConnector = () => {
              const shape = item();
              return (
                shape.type === 'connector' &&
                !!(shape.geometry.start.binding || shape.geometry.end.binding)
              );
            };
            const renderedItem = createMemo(() => {
              const shape = item();
              return shape.type === 'connector' && boundConnector()
                ? connectorWorldView(shape, world())
                : shape;
            });
            const view = createShapeView(renderedItem, () =>
              isConnector()
                ? renderedItem().transform
                : (resolvedShape(scene(), id, overrides()) ?? initial).transform
            );
            const scale = createMemo(
              () =>
                cameraScale() *
                (boundConnector() ? 1 : Math.hypot(world()[0], world()[1]))
            );
            return (
              <div
                ref={(element) => registerMoveElement(id, element)}
                data-graphics-item={id}
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  width: `${shapeDefinition(view.type).bounds(view).width}px`,
                  height: `${shapeDefinition(view.type).bounds(view).height}px`,
                  'transform-origin': '0 0',
                  isolation: 'isolate',
                  transform: cssMatrix(boundConnector() ? IDENTITY : world()),
                  'pointer-events': 'auto',
                }}
              >
                <ShapeView renderers={renderers} item={view} scale={scale()} />
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
                left: '0',
                top: '0',
                transform: cssMatrix(item().transform),
                'transform-origin': '0 0',
                width: `${shapeDefinition(item().type).bounds(item()).width}px`,
                height: `${shapeDefinition(item().type).bounds(item()).height}px`,
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
        <Show when={!props.hideSelection && props.input?.tool?.() === 'select'}>
          <g
            transform={cssMatrix([
              cameraScale(),
              0,
              0,
              cameraScale(),
              projection.camera().x,
              projection.camera().y,
            ])}
          >
            <For each={indicatedShapes()}>
              {(id) => {
                const initial = scene().items[id];
                if (!isShape(initial)) return null;
                const isConnector = () =>
                  scene().items[id]?.type === 'connector';
                const projection = createMemo(() =>
                  shapeProjection(
                    scene(),
                    id,
                    isConnector() ? overrides() : contentOverrides()
                  )
                );
                const transform = createMemo(
                  () => projection().transform,
                  undefined,
                  {
                    equals: (a, b) => a.every((value, i) => value === b[i]),
                  }
                );
                const view = createShapeView(
                  () => projection().item ?? initial
                );
                return (
                  <ShapeSelectionOutline
                    ref={(element) => registerMoveElement(id, element)}
                    item={view}
                    transform={transform()}
                    color="#5687ff"
                    hovered={!selectedShapes().includes(id)}
                  />
                );
              }}
            </For>
          </g>
          <Show when={!projection.session().transform && singleConnector()}>
            {(item) => (
              <For each={['start', 'end'] as const}>
                {(end) => {
                  const point = () =>
                    screen(
                      transformPoint(
                        worldMatrix(scene(), item().id, overrides()),
                        item().geometry[end].point
                      )
                    );
                  return (
                    <circle
                      data-graphics-connector-end={end}
                      data-graphics-connector-id={item().id}
                      aria-label={`Connector ${end}`}
                      role="img"
                      cx={point().x}
                      cy={point().y}
                      r="6"
                      fill="white"
                      stroke="#5687ff"
                      style={{ 'pointer-events': 'all', cursor: 'grab' }}
                    />
                  );
                }}
              </For>
            )}
          </Show>
          <For
            each={selected().filter((id) => {
              const item = overrides()[id] ?? scene().items[id];
              if (!isShape(item) || item.type === 'connector') return false;
              // Every selected shape already has a geometry outline. Only a
              // single curved shape needs an additional box while transforming.
              return (
                selected().length === 1 &&
                !!projection.session().transform &&
                (item.type === 'ellipse' ||
                  item.type === 'pencil' ||
                  (item.type === 'rectangle' && !!item.appearance.cornerRadius))
              );
            })}
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
          <Show
            when={
              !projection.session().transform && !singleConnector() && frame()
            }
          >
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
                style={{
                  'pointer-events':
                    props.selectionHitArea === 'shapes' ? 'none' : 'all',
                  cursor: 'move',
                }}
              />
            )}
          </Show>
          <Show when={!singleConnector()}>
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
          <Show when={radiusRectangle()}>
            {(item) => (
              <RadiusHandles
                item={item()}
                transform={worldMatrix(scene(), item().id, overrides())}
                camera={projection.camera()}
                active={(() => {
                  const handle = projection.session().transform?.handle;
                  return isRadiusHandle(handle) ? handle : undefined;
                })()}
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
      {props.children}
    </div>
  );
}
