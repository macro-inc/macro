import { isMobile } from '@core/mobile/isMobile';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { ZoompinchHandle } from '../Zoompinch';

type Size = { w: number; h: number };

/**
 * The lightbox's zoom model. Zoom is split into card growth × engine scale:
 * each card axis grows with the zoom level independently until it hits the
 * available area, so a capped axis starts cropping while the other keeps
 * growing. The canvas keeps the image's aspect ratio, and the engine's model is
 * "scale 1 = canvas contain-fits the wrapper", so the displayed image size is
 * always base × zoom and exactly fills the card on every uncapped axis.
 */
export function createZoomModel(
  zoompinchHandle: Accessor<ZoompinchHandle | undefined>
) {
  let containerEl: HTMLDivElement | undefined;
  const setContainer = (el: HTMLDivElement) => {
    containerEl = el;
  };

  const [baseSize, setBaseSize] = createSignal<Size>();
  const [zoom, setZoom] = createSignal(1);
  const [currentScale, setCurrentScale] = createSignal(1);
  // Suppresses the rebalance pass while we apply a zoom ourselves.
  let inApplyZoom = false;

  const availableArea = () => {
    if (!containerEl) return undefined;
    return {
      w: containerEl.clientWidth,
      // Mirror the img's sm:max-h-[80vh] cap on desktop
      h: isMobile()
        ? containerEl.clientHeight
        : Math.min(containerEl.clientHeight, window.innerHeight * 0.8),
    };
  };

  const cardSizeFor = (base: Size, z: number) => {
    const avail = availableArea();
    if (!avail) return { w: base.w * z, h: base.h * z };
    return {
      w: Math.min(base.w * z, avail.w),
      h: Math.min(base.h * z, avail.h),
    };
  };

  const cardSize = createMemo(() => {
    const base = baseSize();
    return base ? cardSizeFor(base, zoom()) : undefined;
  });

  // The engine's naturalScale: how far the base-aspect canvas is scaled to
  // contain-fit the card. Engine scale carries the rest of the total zoom.
  const containFactor = (base: Size, card: Size) =>
    Math.min(card.w / base.w, card.h / base.h);

  const totalZoom = createMemo(() => {
    const base = baseSize();
    const card = cardSize();
    return base && card ? currentScale() * containFactor(base, card) : 1;
  });

  // The unzoomed card size: contain-fit into the available area without
  // upscaling, with the img's sm:min-w-50 floor on desktop.
  const measureBase = (img: HTMLImageElement) => {
    const avail = availableArea();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!avail || !nw || !nh) return undefined;
    const fit = Math.min(avail.w / nw, avail.h / nh, 1);
    const width = Math.max(nw * fit, isMobile() ? 0 : 200);
    const scale = width / nw;
    return { w: width, h: nh * scale };
  };

  // The engine caches wrapper/canvas bounds via ResizeObservers, which fire
  // after we resize the card. Refresh them synchronously so transforms applied
  // in the same tick use the new geometry.
  const syncEngineBounds = (handle: ZoompinchHandle) => {
    const { engine, wrapperElement } = handle;
    engine.wrapperBounds = wrapperElement.getBoundingClientRect();
    const canvas = wrapperElement.querySelector(
      '.canvas'
    ) as HTMLElement | null;
    if (canvas) {
      // offsetWidth/Height: layout size, unaffected by the engine's transform
      engine.canvasBounds = {
        ...engine.canvasBounds,
        width: canvas.offsetWidth,
        height: canvas.offsetHeight,
      };
    }
  };

  // The canvas-relative (0-1) content point currently under the wrapper center.
  const centerCanvasRel = (
    engine: ZoompinchHandle['engine']
  ): [number, number] => {
    const [cx, cy] = engine.normalizeClientCoords(
      engine.wrapperInnerX + engine.wrapperInnerWidth / 2,
      engine.wrapperInnerY + engine.wrapperInnerHeight / 2
    );
    return [cx / engine.canvasBounds.width, cy / engine.canvasBounds.height];
  };

  const applyZoom = (
    handle: ZoompinchHandle,
    zoomLevel: number,
    anchor?: [number, number]
  ) => {
    const { engine } = handle;
    const base = baseSize();
    const z = Math.max(1, zoomLevel);
    const f = base ? containFactor(base, cardSizeFor(base, z)) : 1;
    // Without an explicit anchor, keep whatever content point sits at the card
    // center fixed across the resize — read it from the old geometry first.
    const wrapperAnchor = anchor ?? ([0.5, 0.5] as [number, number]);
    const canvasAnchor = anchor ?? centerCanvasRel(engine);
    inApplyZoom = true;
    setZoom(z);
    syncEngineBounds(handle);
    engine.applyTransform(z / f, wrapperAnchor, canvasAnchor);
    inApplyZoom = false;
  };

  // Continuous wheel / trackpad zoom. The engine computes the new scale (so the
  // zoom feel is unchanged), but we discard its cursor-anchored translate and
  // re-apply the zoom anchored at the *pre-gesture* view center via applyZoom.
  // Center-anchoring is what keeps the image continuous across the point where
  // an axis stops growing and starts cropping: while an axis is still growing
  // there is no overflow on it, so the engine force-centers it and an
  // off-center anchor's offset is suppressed — it would otherwise snap free the
  // instant the axis caps, producing a visible jump. Non-zoom wheel events pan.
  const handleWheel = (e: WheelEvent, engine: ZoompinchHandle['engine']) => {
    const handle = zoompinchHandle();
    const base = baseSize();
    const card = cardSize();
    if (e.ctrlKey && handle && base && card) {
      e.preventDefault();
      const anchor = centerCanvasRel(engine); // capture before the engine moves
      // Let the engine derive the new scale, but suppress the rebalance pass —
      // we re-apply the zoom ourselves below with the correct anchor.
      inApplyZoom = true;
      engine.handleWheel(e);
      inApplyZoom = false;
      applyZoom(handle, engine.scale * containFactor(base, card), anchor);
      return;
    }
    // Pan. The engine's own wheel-pan multiplies the delta by 25 and only
    // normalizes when |delta| >= 100, so trackpads and hi-res mice — whose
    // deltas are small (often fractional) — lurch hundreds of px per event,
    // snapping straight to the clamp edge. Pan 1:1 with the real pixel delta
    // instead. (deltaMode: 0 = px, 1 = lines, 2 = pages.)
    e.preventDefault();
    const unit =
      e.deltaMode === 1
        ? 16
        : e.deltaMode === 2
          ? engine.wrapperBounds.height
          : 1;
    engine.setTranslateFromUserGesture(
      engine.translateX - e.deltaX * unit,
      engine.translateY - e.deltaY * unit
    );
    engine.update();
  };

  // Rebalance after engine-driven zoom (wheel/pinch): move as much of the
  // total zoom as possible into card growth, leaving the rest on the engine.
  // Runs synchronously inside the engine's update event, before paint.
  const rebalanceZoom = (engine: ZoompinchHandle['engine']) => {
    if (inApplyZoom) return;
    const handle = zoompinchHandle();
    const base = baseSize();
    const card = cardSize();
    if (!handle || !base || !card) return;
    const z = Math.max(1, engine.scale * containFactor(base, card));
    const target = cardSizeFor(base, z);
    if (
      Math.abs(z / containFactor(base, target) - engine.scale) > 0.001 ||
      Math.abs(target.w - card.w) > 0.5 ||
      Math.abs(target.h - card.h) > 0.5
    ) {
      applyZoom(handle, z);
    }
  };

  // Forwarded to Zoompinch's onUpdate — track the engine scale and rebalance.
  const onEngineUpdate = (engine: ZoompinchHandle['engine']) => {
    setCurrentScale(engine.scale);
    rebalanceZoom(engine);
  };

  // Reset to the zoom floor (1): apply it to the live handle, or just record
  // the level when there's no handle yet.
  const resetZoom = () => {
    const handle = zoompinchHandle();
    if (handle) applyZoom(handle, 1);
    else setZoom(1);
  };

  // Measure the freshly-loaded image and snap to the zoom floor.
  const handleImageLoad = (img: HTMLImageElement) => {
    const base = measureBase(img);
    if (!base) return;
    setBaseSize(base);
    resetZoom();
  };

  return {
    setContainer,
    baseSize,
    cardSize,
    totalZoom,
    currentScale,
    applyZoom,
    handleWheel,
    onEngineUpdate,
    handleImageLoad,
    resetZoom,
  };
}
