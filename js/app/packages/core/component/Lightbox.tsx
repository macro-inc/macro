import * as stackingContext from '@core/constant/stackingContext';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Dialog, useDialogContext } from '@kobalte/core/dialog';
import ChevronLeftIcon from '@phosphor/caret-left.svg';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import XIcon from '@phosphor/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { isIOS } from '@solid-primitives/platform';
import { Button, cn } from '@ui';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import {
  copyImageToClipboard,
  downloadImage as downloadImageAction,
} from '../util/imageActions';
import { platformFetch } from '../util/platformFetch';

import { Zoompinch, type ZoompinchHandle } from './Zoompinch';

const SpinnerIcon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (p) => (
  <Spinner {...p} class="animate-spin" />
);

type LightboxProps = {
  // Current image to display
  src: Accessor<string | undefined>;
  // Used for the download filename
  imageId: Accessor<string>;
  // Optional pre-fetched blob override (e.g. DSS images). Falls back to fetching `src`.
  getBlob?: () => Promise<Blob | undefined>;
  // Gallery navigation. Passing either enables swipe (mobile) + arrow key (desktop) support.
  // Pass undefined for a direction when that navigation is unavailable (first/last image).
  onPrevious?: () => void;
  onNext?: () => void;
  // "2/5" style indicator — rendered when provided
  indexLabel?: Accessor<string>;
  navigationHidden?: boolean;
};

export function Lightbox(props: LightboxProps) {
  const dialogContext = useDialogContext();

  const [zoompinchHandle, setZoompinchHandle] = createSignal<
    ZoompinchHandle | undefined
  >();
  let hideToolbarTimeout: ReturnType<typeof setTimeout> | undefined;

  const fetchBlob = async (): Promise<Blob | undefined> => {
    if (props.getBlob) return props.getBlob();
    const url = props.src();
    if (!url) return undefined;
    return (await platformFetch(url)).blob();
  };

  // Pre-fetch the blob on iOS so it is already in memory when the user taps
  // copy/download. This keeps navigator.share() close to synchronous with the
  // gesture — the user-activation window expires if a network round-trip is
  // needed. Desktop clipboard doesn't have this constraint.
  const [cachedBlob, setCachedBlob] = createSignal<Blob | undefined>();
  // True while the iOS pre-fetch is in flight. We surface this as a loading
  // state on the copy/download buttons so the blob is guaranteed to be in
  // memory before the user can tap. Without this, tapping download on a large
  // image (whose pre-fetch hasn't finished yet) falls through to an awaited
  // network fetch, which consumes the tap's user activation and makes
  // navigator.share() silently no-op until a second tap.
  const [isPrefetching, setIsPrefetching] = createSignal(false);
  if (isIOS) {
    createEffect(() => {
      const currentSrc = props.src(); // re-fetch when navigating to a new image
      let isStale = false;
      onCleanup(() => {
        isStale = true;
      });

      setCachedBlob(undefined);
      setIsPrefetching(true);
      untrack(() => fetchBlob())
        .then((blob) => {
          if (isStale || props.src() !== currentSrc) return;
          if (blob) setCachedBlob(blob);
        })
        .catch(() => {})
        .finally(() => {
          if (!isStale && props.src() === currentSrc) setIsPrefetching(false);
        });
    });
  }
  const fetchBlobCached = (): Promise<Blob | undefined> => {
    const cached = cachedBlob();
    return cached ? Promise.resolve(cached) : fetchBlob();
  };

  const [isCopying, setIsCopying] = createSignal(false);
  const [isDownloading, setIsDownloading] = createSignal(false);

  const copyToClipboard = async () => {
    if (isCopying()) return;
    setIsCopying(true);
    try {
      await copyImageToClipboard(fetchBlobCached, props.src() ?? '');
    } finally {
      setIsCopying(false);
    }
  };

  const downloadImage = async () => {
    if (isDownloading()) return;
    setIsDownloading(true);
    try {
      await downloadImageAction(fetchBlobCached, props.imageId());
    } finally {
      setIsDownloading(false);
    }
  };

  // Reactive cursor state — drives the cursor style on the Zoompinch wrapper.
  const [isDragging, setIsDragging] = createSignal(false);
  const [currentScale, setCurrentScale] = createSignal(1);

  // Zoom is split into card growth × engine scale. Each card axis grows with
  // the zoom level independently until it hits the available area, so a
  // capped axis starts cropping while the other keeps growing. The canvas
  // keeps the image's aspect ratio, and the engine's model is "scale 1 =
  // canvas contain-fits the wrapper", so the displayed image size is always
  // base × zoom and exactly fills the card on every uncapped axis.
  let containerEl: HTMLDivElement | undefined;
  const [baseSize, setBaseSize] = createSignal<{ w: number; h: number }>();
  const [zoom, setZoom] = createSignal(1);
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

  const cardSizeFor = (base: { w: number; h: number }, z: number) => {
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
  const containFactor = (
    base: { w: number; h: number },
    card: { w: number; h: number }
  ) => Math.min(card.w / base.w, card.h / base.h);

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
    return { w: Math.max(nw * fit, isMobile() ? 0 : 200), h: nh * fit };
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

  const cursor = createMemo(() => {
    if (isDragging() && currentScale() > 1.01) return 'grab';
    if (totalZoom() > 1.01) return 'zoom-out';
    return 'zoom-in';
  });

  // Single-finger swipe state. On touch devices, when fully zoomed out, a
  // single-finger drag is a swipe gesture: horizontal navigates the gallery,
  // a downward swipe dismisses the lightbox. The axis is locked on the first
  // clearly-directional movement so the two don't fight.
  const SWIPE_DISMISS_DISTANCE = 100; // px of downward travel to dismiss
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeEndX = 0;
  let swipeEndY = 0;
  let swipeAxis: 'x' | 'y' | null = null;
  let isSwiping = false;
  let zoompinchHandlingTouch = false;

  const touchOnStart = (e: TouchEvent, engine: ZoompinchHandle['engine']) => {
    const doSwipeDetection =
      isTouchDevice() && e.touches.length === 1 && totalZoom() <= 1.01;
    if (doSwipeDetection) {
      swipeStartX = swipeEndX = e.touches[0].clientX;
      swipeStartY = swipeEndY = e.touches[0].clientY;
      swipeAxis = null;
      isSwiping = false;
      zoompinchHandlingTouch = false;
    } else {
      engine.handleTouchstart(e);
      zoompinchHandlingTouch = true;
    }
  };

  const touchOnWindowMove = (
    e: TouchEvent,
    engine: ZoompinchHandle['engine']
  ) => {
    if (zoompinchHandlingTouch) {
      engine.handleTouchmove(e);
      return;
    }
    // Second finger appeared mid-gesture: switch to zoompinch
    if (e.touches.length > 1) {
      engine.handleTouchstart(e);
      zoompinchHandlingTouch = true;
      isSwiping = false;
      return;
    }
    swipeEndX = e.touches[0].clientX;
    swipeEndY = e.touches[0].clientY;
    const dx = swipeEndX - swipeStartX;
    const dy = swipeEndY - swipeStartY;
    // Lock to the dominant axis once the gesture is clearly directional.
    if (!swipeAxis && Math.hypot(dx, dy) > 10) {
      swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    // Downward-only on the y axis — an upward drag is left alone.
    if (
      (swipeAxis === 'x' && Math.abs(dx) > 30) ||
      (swipeAxis === 'y' && dy > 30)
    ) {
      isSwiping = true;
    }
    if (isSwiping) e.preventDefault();
  };

  const touchOnWindowEnd = (
    e: TouchEvent,
    engine: ZoompinchHandle['engine']
  ) => {
    if (zoompinchHandlingTouch) {
      engine.handleTouchend(e);
      zoompinchHandlingTouch = false;
      return;
    }
    if (isSwiping && totalZoom() <= 1.01) {
      if (swipeAxis === 'x') {
        const diff = swipeStartX - swipeEndX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) props.onNext?.();
          else props.onPrevious?.();
        }
      } else if (
        swipeAxis === 'y' &&
        swipeEndY - swipeStartY > SWIPE_DISMISS_DISTANCE
      ) {
        dialogContext.close();
      }
    }
    swipeAxis = null;
    isSwiping = false;
    swipeStartX = swipeStartY = swipeEndX = swipeEndY = 0;
    zoompinchHandlingTouch = false;
  };

  // Keyboard nav + toolbar fade — active while the Zoompinch handle is set
  createEffect(() => {
    const handle = zoompinchHandle();
    if (!handle) return;
    const { engine, wrapperElement: wrapper } = handle;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialogContext.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        props.onPrevious?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        props.onNext?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (!isMobile()) {
      // Track dragging so click-to-zoom and cursor stay in sync
      let isMouseDown = false;
      let mouseDownX = 0;
      let mouseDownY = 0;

      const handleMouseDown = (e: MouseEvent) => {
        isMouseDown = true;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        setIsDragging(false);
      };
      const handleWindowMouseMove = (e: MouseEvent) => {
        if (!isMouseDown) return;
        if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > 5) {
          setIsDragging(true);
        }
      };
      const handleWindowMouseUp = () => {
        isMouseDown = false;
        // Delay reset so the click event (which fires after mouseup) can still
        // read isDragging=true and suppress the zoom-out action.
        setTimeout(() => setIsDragging(false), 0);
      };

      // Click-to-zoom: zoom in at cursor position, or reset if already zoomed
      const handleClick = (e: MouseEvent) => {
        if (isDragging()) return;
        const b = engine.wrapperBounds;
        const relX = (e.clientX - b.x) / b.width;
        const relY = (e.clientY - b.y) / b.height;
        if (totalZoom() <= 1.01) {
          applyZoom(handle, 2.5, [relX, relY]);
        } else {
          applyZoom(handle, 1);
        }
      };

      wrapper.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
      wrapper.addEventListener('click', handleClick);

      onCleanup(() => {
        wrapper.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
        wrapper.removeEventListener('click', handleClick);
      });
    }

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      if (hideToolbarTimeout) clearTimeout(hideToolbarTimeout);
    });
  });

  // Reset zoom when navigating to a different image.
  createEffect(() => {
    props.src();
    untrack(() => {
      const handle = zoompinchHandle();
      if (handle) applyZoom(handle, 1);
      else setZoom(1);
    });
  });

  const navButtonClass =
    'absolute top-1/2 -translate-y-1/2 bg-surface backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-surface transition-opacity duration-300 disabled:cursor-not-allowed disabled:opacity-50';

  const navVisible = () => true;

  return (
    <div
      ref={containerEl}
      class="fixed inset-0 z-modal flex items-center justify-center"
      style={{
        'margin-top': 'max(var(--safe-top), 0.5rem)',
        'margin-bottom': 'max(var(--safe-bottom), 1.5rem)',
        'margin-left': 'max(var(--safe-left), 0.5rem)',
        'margin-right': 'max(var(--safe-right), 0.5rem)',
      }}
    >
      <Dialog.Content class="flex items-center justify-center bg-surface rounded-md overflow-hidden">
        {/* Toolbar */}
        <LightboxToolbar isVisible={true}>
          <Button
            variant="ghost"
            size="icon-md"
            onClick={copyToClipboard}
            disabled={isCopying() || isPrefetching()}
            label="Copy image"
          >
            {isCopying() ? <SpinnerIcon /> : <ClipboardIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-md"
            onClick={downloadImage}
            disabled={isDownloading() || isPrefetching()}
            label="Download image"
          >
            {isDownloading() ? <SpinnerIcon /> : <DownloadIcon />}
          </Button>
          <Dialog.CloseButton>
            <Button variant="ghost" size="icon-md" label="Close">
              <XIcon />
            </Button>
          </Dialog.CloseButton>
        </LightboxToolbar>

        {/* Nav arrows — desktop only */}
        <Show when={!isMobile()}>
          <Show when={!props.navigationHidden}>
            <button
              class={cn(
                navButtonClass,
                'left-4',
                navVisible() ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{ 'z-index': stackingContext.zModal + 1 }}
              onClick={props.onPrevious}
              disabled={!props.onPrevious}
              aria-label="Previous image"
            >
              <ChevronLeftIcon class="size-5 text-ink" />
            </button>

            <button
              class={cn(
                navButtonClass,
                'right-4',
                navVisible() ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{ 'z-index': stackingContext.zModal + 1 }}
              onClick={props.onNext}
              disabled={!props.onNext}
              aria-label="Next image"
            >
              <ChevronRightIcon class="size-5 text-ink" />
            </button>
          </Show>
        </Show>

        {/* Index indicator */}
        <Show when={props.indexLabel}>
          <div
            class={cn(
              'absolute top-4 left-4 bg-surface backdrop-blur-sm rounded-lg border border-edge px-3 py-1.5 shadow-md transition-opacity duration-300',
              navVisible() ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            style={{ 'z-index': stackingContext.zModal + 1 }}
          >
            <span class="text-sm text-ink font-medium">
              {props.indexLabel?.()}
            </span>
          </div>
        </Show>

        {/* Image */}
        <div class="size-full flex items-center justify-center">
          <Show
            when={props.src()}
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 size-15 border border-edge bg-surface">
                <Spinner class="size-4 animate-spin" />
              </div>
            }
          >
            <Zoompinch
              handleRef={setZoompinchHandle}
              clampBounds
              // Engine min below 1 so gestures can zoom out past the engine's
              // own floor; rebalanceZoom transfers that into card shrinkage
              // and enforces the real floor of total zoom = 1.
              minScale={0.1}
              onUpdate={(engine) => {
                setCurrentScale(engine.scale);
                rebalanceZoom(engine);
              }}
              onWheel={handleWheel}
              touch={{
                onStart: touchOnStart,
                onWindowMove: touchOnWindowMove,
                onWindowEnd: touchOnWindowEnd,
              }}
              class={cn('relative overflow-hidden', !cardSize() && 'size-full')}
              style={{
                cursor: cursor(),
                ...(cardSize() && {
                  width: `${cardSize()!.w}px`,
                  height: `${cardSize()!.h}px`,
                }),
              }}
              // Give the canvas the image's own aspect ratio so the engine's
              // contain-fit and clamping track the image content, not the
              // (possibly differently-shaped) card.
              canvasStyle={
                baseSize()
                  ? {
                      width: `${baseSize()!.w}px`,
                      height: `${baseSize()!.h}px`,
                    }
                  : undefined
              }
            >
              <img
                class="size-full sm:min-w-50 sm:max-h-[80vh] object-contain select-none"
                style={{ '-webkit-touch-callout': 'none' }}
                src={props.src()}
                alt="preview"
                onLoad={(e) => {
                  const base = measureBase(e.currentTarget);
                  if (!base) return;
                  setBaseSize(base);
                  const handle = zoompinchHandle();
                  if (handle) applyZoom(handle, 1);
                  else setZoom(1);
                }}
              />
            </Zoompinch>
          </Show>
        </div>
      </Dialog.Content>
    </div>
  );
}

type LightboxToolbarProps = {
  isVisible: boolean;
  children: JSX.Element;
};

export function LightboxToolbar(props: LightboxToolbarProps) {
  return (
    <div
      class="absolute top-4 right-4 bg-surface backdrop-blur-sm rounded-lg border border-edge p-1 flex flex-row items-center gap-1 shadow-md transition-opacity duration-300"
      classList={{
        'opacity-100': isMobile() || props.isVisible,
        'opacity-0 pointer-events-none': !isMobile() && !props.isVisible,
      }}
      style={{ 'z-index': stackingContext.zModal + 1 }}
    >
      {props.children}
    </div>
  );
}
