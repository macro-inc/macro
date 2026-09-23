import {
  type Component,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { GraphicsInputOptions } from '../browser';
import { attachCameraControls } from '../browser';
import type { GraphicsEditor } from '../core/editor';
import type { GraphicsItem, RectangleItem } from '../core/model';

/** Must be created under a Solid owner; disposing that owner releases the subscription. */
export function createGraphicsProjection(editor: GraphicsEditor) {
  const [camera, setCamera] = createSignal(editor.getCamera());
  const [document, setDocument] = createStore(editor.document);
  const [preview, setPreview] = createSignal(editor.getPreview());
  onCleanup(editor.subscribeCamera(setCamera));
  onCleanup(editor.subscribeDocument((next) => setDocument(reconcile(next))));
  onCleanup(editor.subscribePreview(setPreview));
  return { camera, document, preview };
}

export type ItemRenderers = {
  [K in GraphicsItem['type']]: Component<{
    item: Extract<GraphicsItem, { type: K }>;
    scale: number;
  }>;
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

const defaultRenderers: ItemRenderers = { rectangle: RectangleView };

/** A bounded viewport onto an unbounded world. The host supplies theme colors and size. */
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
  const gridStep = () => {
    let step = 32 * projection.camera().scale;
    while (step < 16) step *= 2;
    return step;
  };
  const Rectangle = props.renderers?.rectangle ?? defaultRenderers.rectangle;
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
        <For each={projection.document.order}>
          {(id) => {
            const item = projection.document.items[id];
            if (!item) return null;
            return (
              <div
                data-graphics-item={id}
                style={{
                  position: 'absolute',
                  left: `${item.geometry.x}px`,
                  top: `${item.geometry.y}px`,
                  width: `${item.geometry.width}px`,
                  height: `${item.geometry.height}px`,
                  'pointer-events': 'auto',
                }}
              >
                <Rectangle item={item} scale={projection.camera().scale} />
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
    </div>
  );
}
