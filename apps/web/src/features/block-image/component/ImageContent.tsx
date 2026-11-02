import { SWIPE_EDGE_THRESHOLD } from '@components/app/split-layout/mobile/createMobileSplitMotion';
import { createMomentum } from '@core/component/Lightbox/createMomentum';
import { createZoomModel } from '@core/component/Lightbox/createZoomModel';
import { Zoompinch, type ZoompinchHandle } from '@core/component/Zoompinch';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';

export function ImageContent(props: { file: Blob; alt: string }) {
  const [imageUrl, setImageUrl] = createSignal<string>();

  createEffect(
    on(
      () => props.file,
      (file) => {
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        onCleanup(() => URL.revokeObjectURL(url));
      }
    )
  );

  return (
    <Show
      when={imageUrl()}
      fallback={<div class="size-full" aria-label="Loading image" />}
    >
      {(url) => (
        <Show
          when={isTouchDevice()}
          fallback={
            <div class="flex size-full items-center justify-center">
              <img
                src={url()}
                alt={props.alt}
                class="max-h-full max-w-full object-contain"
              />
            </div>
          }
        >
          <PinchZoomImage src={url()} alt={props.alt} />
        </Show>
      )}
    </Show>
  );
}

/**
 * Touch image view with pinch-to-zoom and panning. The viewport disables
 * native page zoom, so the zoom comes from the lightbox's zoom model: a pinch
 * grows the image until it fills the pane, then crops and pans.
 */
function PinchZoomImage(props: { src: string; alt: string }) {
  const [zoompinchHandle, setZoompinchHandle] = createSignal<
    ZoompinchHandle | undefined
  >();
  const [restingImage, setRestingImage] = createSignal<HTMLImageElement>();
  const zoom = createZoomModel(zoompinchHandle);
  const momentum = createMomentum(zoompinchHandle);

  // The unzoomed size is the browser's own layout of the image in the pane,
  // not its natural size: an SVG with only a viewBox reports 300×150 but
  // stretches to fill. Following that layout also re-fits the image, and resets
  // the zoom, when the pane resizes.
  createResizeObserver(restingImage, ({ width, height }) => {
    if (width && height) zoom.setBase({ w: width, h: height });
  });

  // WebKit rasterizes an <img> at its layout size, so the engine's scale()
  // transform blurs a zoomed image, an SVG most of all. Keep the engine's
  // gesture math, but lay the image out at its zoomed size and only translate.
  let zoomedImage: HTMLImageElement | undefined;
  const onEngineUpdate = (engine: ZoompinchHandle['engine']) => {
    zoom.onEngineUpdate(engine);
    if (!zoomedImage) return;
    const x = engine.offset.left + engine.translateX;
    const y = engine.offset.top + engine.translateY;
    const scale = engine.naturalScale * engine.scale;
    engine.canvasElement.style.transform = `translate(${x}px, ${y}px)`;
    zoomedImage.style.width = `${engine.canvasBounds.width * scale}px`;
    zoomedImage.style.height = `${engine.canvasBounds.height * scale}px`;
  };

  // Zoompinch's touchmove/touchend listeners are on the window. Only touches
  // in the pane are handled, and a single finger only once zoomed in and away
  // from the left edge, so taps and the pane's swipe-back keep working.
  let containerElement: HTMLDivElement | undefined;
  let handlingTouch = false;
  const startHandling = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    handlingTouch = true;
    momentum.cancelMomentum();
    engine.handleTouchstart(e);
    momentum.resetMomentumTracking(e, engine);
  };
  // Fingers around a small image land beside it, outside Zoompinch's own
  // touchstart listener: take over once two fingers are down in the pane.
  const isPinchInPane = (e: TouchEvent) =>
    e.touches.length > 1 &&
    Array.from(e.touches).every(
      (t) => t.target instanceof Node && containerElement?.contains(t.target)
    );
  const touch = {
    onStart: (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
      momentum.cancelMomentum();
      handlingTouch = false;
      const canPan =
        zoom.totalZoom() > 1.01 && e.touches[0].clientX >= SWIPE_EDGE_THRESHOLD;
      if (e.touches.length > 1 || canPan) startHandling(e, engine);
    },
    onWindowMove: (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
      if (!handlingTouch) {
        if (isPinchInPane(e)) startHandling(e, engine);
        return;
      }
      engine.handleTouchmove(e);
      // A single-finger pan can fling; a pinch shouldn't.
      if (e.touches.length === 1) momentum.sampleMomentum(e);
      else momentum.resetMomentumTracking(e, engine);
    },
    onWindowEnd: (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
      if (!handlingTouch) return;
      engine.handleTouchend(e);
      if (e.touches.length > 0) {
        momentum.resetMomentumTracking(e, engine);
        return;
      }
      handlingTouch = false;
      if (zoom.totalZoom() > 1.01) momentum.startMomentum(e, engine);
    },
  };

  return (
    <div
      ref={(element) => {
        containerElement = element;
        zoom.setContainer(element);
      }}
      class="relative flex size-full touch-none items-center justify-center overflow-hidden"
    >
      <div
        aria-hidden="true"
        class="pointer-events-none invisible absolute inset-0 flex items-center justify-center"
      >
        <img
          ref={setRestingImage}
          src={props.src}
          alt=""
          class="max-h-full max-w-full object-contain"
        />
      </div>
      <Zoompinch
        handleRef={setZoompinchHandle}
        clampBounds
        // Below 1 so a pinch can zoom out past the engine's floor; the zoom
        // model moves that into the image size and keeps the real floor at 1.
        minScale={0.1}
        onUpdate={onEngineUpdate}
        onWheel={zoom.handleWheel}
        touch={touch}
        class={cn('relative overflow-hidden', !zoom.cardSize() && 'size-full')}
        style={
          zoom.cardSize() && {
            width: `${zoom.cardSize()!.w}px`,
            height: `${zoom.cardSize()!.h}px`,
          }
        }
        canvasStyle={
          zoom.baseSize() && {
            width: `${zoom.baseSize()!.w}px`,
            height: `${zoom.baseSize()!.h}px`,
          }
        }
      >
        <img
          ref={zoomedImage}
          src={props.src}
          alt={props.alt}
          class={cn(
            'size-full max-w-none object-contain select-none',
            !zoom.baseSize() && 'invisible'
          )}
          style={{ '-webkit-touch-callout': 'none' }}
        />
      </Zoompinch>
    </div>
  );
}
