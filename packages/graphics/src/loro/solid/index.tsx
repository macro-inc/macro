import {
  type ComponentProps,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from 'solid-js';
import { corners, cssMatrix } from '../../core/affine';
import { worldToScreen } from '../../core/camera';
import type { GraphicsEditor } from '../../core/editor';
import type { Point, ShapeItem } from '../../core/model';
import { nodeCorners, roots, worldBounds } from '../../core/scene';
import { isShape, shapePayload } from '../../core/shapes/registry';
import { createGraphicsProjection, GraphicsSurface } from '../../solid';
import { defaultRenderers, ShapeView } from '../../solid/shape-renderers';
import type { GraphicsPresence } from '../presence';
import {
  currentPresencePreview,
  type PeerPresence,
  type PresenceShape,
} from '../presence-state';
import { attachPresencePointer } from './pointer';
import { createPresenceMotion } from './presence-motion';

function GhostShape(props: {
  shape: PresenceShape;
  color: string;
  scale: number;
}) {
  const item = (): ShapeItem => ({
    id: props.shape.id,
    ...shapePayload(
      props.shape.kind,
      props.shape.kind === 'pencil'
        ? props.shape.pencil
        : { width: props.shape.width, height: props.shape.height }
    ),
    placement: { parentId: 'presence-root', sortKey: 'a0' },
    transform: props.shape.world,
    appearance: {
      fill: 'transparent',
      stroke: props.color,
      strokeWidth: props.shape.strokeWidth,
      cornerRadius: props.shape.cornerRadius,
    },
  });
  return (
    <div
      data-presence-preview={props.shape.id}
      style={{
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${props.shape.width}px`,
        height: `${props.shape.height}px`,
        transform: cssMatrix(props.shape.world),
        'transform-origin': '0 0',
      }}
    >
      <ShapeView
        item={item()}
        renderers={defaultRenderers}
        scale={
          props.scale * Math.hypot(props.shape.world[0], props.shape.world[1])
        }
        preview
      />
    </div>
  );
}

/** A read-only sibling overlay. Remote state never enters GraphicsSurface/editor. */
export function GraphicsPresenceOverlay(props: {
  editor: GraphicsEditor;
  presence: GraphicsPresence;
}) {
  const projection = createGraphicsProjection(props.editor);
  const [peers, setPeers] = createSignal<PeerPresence[]>([]);
  const motion = createPresenceMotion(setPeers);
  const receive = () =>
    motion.update(
      props.presence.getRemote().map((peer) => ({
        ...peer,
        preview: currentPresencePreview(peer, props.presence.getClock()),
      }))
    );
  onCleanup(props.presence.subscribe(receive));
  // Clear obsolete ghosts immediately, even while a spring is in flight.
  onCleanup(props.editor.subscribeDocument(receive));
  onCleanup(motion.dispose);
  receive();
  const screen = (point: Point) => worldToScreen(projection.camera(), point);
  const points = (polygon: readonly Point[]) =>
    polygon
      .map(screen)
      .map((point) => `${point.x},${point.y}`)
      .join(' ');
  return (
    <div
      aria-label="Peer awareness"
      style={{
        position: 'absolute',
        inset: '0',
        overflow: 'hidden',
        'pointer-events': 'none',
        'z-index': 2,
      }}
    >
      <For each={peers().map((peer) => peer.id)}>
        {(id) => {
          const peer = () => peers().find((value) => value.id === id)!;
          const preview = () => peer().preview;
          const outlines = () => {
            const action = preview();
            if (action && action.kind !== 'draw' && action.kind !== 'marquee')
              return []; // The ghost itself outlines the pending pose.
            return roots(projection.document, peer().selectedIds).map(
              (selected) =>
                isShape(projection.document.items[selected])
                  ? nodeCorners(projection.document, selected)
                  : corners(worldBounds(projection.document, selected))
            );
          };
          return (
            <div data-presence-peer={id}>
              <div
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  'transform-origin': '0 0',
                  transform: `translate(${projection.camera().x}px, ${projection.camera().y}px) scale(${projection.camera().scale})`,
                  opacity: 0.7,
                }}
              >
                <For each={preview()?.shapes.map((shape) => shape.id) ?? []}>
                  {(shapeId) => (
                    <GhostShape
                      shape={
                        preview()!.shapes.find((shape) => shape.id === shapeId)!
                      }
                      color={peer().color}
                      scale={projection.camera().scale}
                    />
                  )}
                </For>
              </div>
              <svg
                width="100%"
                height="100%"
                style={{
                  position: 'absolute',
                  inset: '0',
                  overflow: 'visible',
                }}
              >
                <For each={outlines()}>
                  {(outline) => (
                    <polygon
                      data-presence-selection={id}
                      points={points(outline)}
                      fill="none"
                      stroke={peer().color}
                      stroke-width="1.5"
                      stroke-dasharray="5 3"
                    />
                  )}
                </For>
                <Show when={preview()?.box}>
                  {(box) => (
                    <polygon
                      data-presence-marquee={id}
                      points={points(corners(box()))}
                      fill={peer().color}
                      fill-opacity="0.08"
                      stroke={peer().color}
                      stroke-width="1.5"
                      stroke-dasharray="5 3"
                    />
                  )}
                </Show>
              </svg>
              <Show when={peer().cursor}>
                {(cursor) => (
                  <div
                    data-presence-cursor={id}
                    style={{
                      position: 'absolute',
                      left: '0',
                      top: '0',
                      transform: `translate(${screen(cursor()).x}px, ${screen(cursor()).y}px)`,
                    }}
                  >
                    <svg
                      width="20"
                      height="24"
                      viewBox="0 0 20 24"
                      style={{
                        position: 'absolute',
                        left: '0',
                        top: '0',
                        overflow: 'visible',
                      }}
                    >
                      <path
                        d="M1.5 1.5 L17 12.5 Q18.5 14 16.5 14.5 L9 16 L3 22 Q1 23.5 1 21 Z"
                        fill={peer().color}
                        stroke={peer().color}
                        stroke-width="1.5"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <span
                      data-presence-label={id}
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '25px',
                        background: peer().color,
                        color: '#202124',
                        padding: '3px 9px',
                        'border-radius': '10px',
                        'font-size': '14px',
                        'font-weight': 650,
                        'line-height': '20px',
                        'white-space': 'nowrap',
                      }}
                    >
                      {peer().name}
                    </span>
                  </div>
                )}
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export function CollaborativeGraphicsSurface(
  props: ComponentProps<typeof GraphicsSurface> & { presence: GraphicsPresence }
) {
  const [local, surface] = splitProps(props, ['presence']);
  let host!: HTMLDivElement;
  onMount(() =>
    onCleanup(attachPresencePointer(host, props.editor, local.presence))
  );
  return (
    <div
      ref={host}
      style={{
        position: 'relative',
        isolation: 'isolate',
        width: '100%',
        height: '100%',
      }}
    >
      <GraphicsSurface {...surface} />
      <GraphicsPresenceOverlay
        editor={props.editor}
        presence={local.presence}
      />
    </div>
  );
}
