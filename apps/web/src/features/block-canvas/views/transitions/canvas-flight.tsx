import {
  createGraphicsEditor,
  type GraphicsDocument,
} from '@macro-inc/graphics';
import { GraphicsSurface } from '@macro-inc/graphics/solid';
import { onCleanup, onMount } from 'solid-js';
import type { CameraPlan } from '../../core/transitions/camera-plan';
import { ArtifactFrame } from '../artifact-frame';
import { STATIC_ITEM_RENDERERS } from '../static-item-renderers';

export type FlightLayers = Readonly<{
  world: HTMLElement;
  fromMask: HTMLElement;
  toMask: HTMLElement;
}>;

/**
 * The canvas itself, drawn once for a camera transition: a read-only scene of
 * the transition's start, drawn at the plan's base scale into a world layer the
 * camera moves with one transform. Endpoint slides mount eagerly so the first
 * and last frames are never blank; other artifacts mount as they come on
 * screen, as on the canvas.
 */
export function CanvasFlight(props: {
  document: GraphicsDocument;
  plan: CameraPlan;
  eagerIds: readonly string[];
  /** The world layer and masks, once the endpoint slides have loaded. */
  onReady: (layers: FlightLayers) => void;
}) {
  let world!: HTMLDivElement;
  let fromMask!: HTMLDivElement;
  let toMask!: HTMLDivElement;
  const editor = createGraphicsEditor(props.document);
  onCleanup(() => editor.dispose());

  const { region, baseScale } = props.plan;
  // From the initial camera, zooming about the origin then panning puts the
  // region's top-left corner at the layer's.
  editor.zoomAt({ x: 0, y: 0 }, baseScale);
  editor.panBy({ x: -region.x * baseScale, y: -region.y * baseScale });

  const waiting = new Set(props.eagerIds);
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    props.onReady({ world, fromMask, toMask });
  };
  const loaded = (id: string) => {
    waiting.delete(id);
    if (!waiting.size) announce();
  };

  onMount(() => {
    // A slide that never loads (a broken document) must not hold the show.
    const fallback = setTimeout(announce, 500);
    onCleanup(() => clearTimeout(fallback));
    if (!waiting.size) announce();
  });

  const mask = (rect: CameraPlan['fromScreen']) => ({
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    // One spread shadow letterboxes everything outside the slide.
    'box-shadow': '0 0 0 200vmax black',
  });

  return (
    <div
      inert
      aria-hidden="true"
      data-canvas-transition-flight
      class="pointer-events-none absolute inset-0 overflow-hidden bg-panel text-ink"
    >
      <div
        ref={world}
        class="absolute left-0 top-0 origin-top-left"
        style={{
          width: `${region.width * baseScale}px`,
          height: `${region.height * baseScale}px`,
        }}
      >
        <GraphicsSurface
          editor={editor}
          hideSelection
          gridColor="transparent"
          input={{ editing: false, tool: () => 'pan' }}
          renderers={{
            ...STATIC_ITEM_RENDERERS,
            artifact: (p) => (
              <div class="relative size-full overflow-hidden bg-panel">
                <ArtifactFrame
                  html={p.item.geometry.html}
                  title={p.item.geometry.title}
                  designWidth={p.item.geometry.designWidth}
                  designHeight={p.item.geometry.designHeight}
                  interactive={false}
                  eager={props.eagerIds.includes(p.item.id)}
                  onLoad={() => loaded(p.item.id)}
                />
              </div>
            ),
          }}
        />
      </div>
      <div
        ref={fromMask}
        class="absolute"
        style={mask(props.plan.fromScreen)}
      />
      <div ref={toMask} class="absolute" style={mask(props.plan.toScreen)} />
    </div>
  );
}
