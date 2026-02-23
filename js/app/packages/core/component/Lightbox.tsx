import * as stackingContext from '@core/constant/stackingContext';
import { cn } from '@ui/utils/classname';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createZoompinch } from '@core/util/createZoompinch';
import ChevronLeftIcon from '@icon/regular/caret-left.svg';
import ChevronRightIcon from '@icon/regular/caret-right.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';
import DownloadIcon from '@icon/regular/download-simple.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { platformFetch } from '../util/platformFetch';
import { DeprecatedIconButton } from './DeprecatedIconButton';
import { toast } from './Toast/Toast';

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
};

export function Lightbox(props: LightboxProps) {
  const [wrapperRef, setWrapperRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [isToolbarVisible, setIsToolbarVisible] = createSignal(false);
  let hideToolbarTimeout: number | undefined;

  const handleMouseMove = () => {
    if (isTouchDevice()) return;
    setIsToolbarVisible(true);
    if (hideToolbarTimeout) clearTimeout(hideToolbarTimeout);
    hideToolbarTimeout = setTimeout(
      () => setIsToolbarVisible(false),
      1000
    ) as unknown as number;
  };

  const fetchBlob = async (): Promise<Blob | undefined> => {
    if (props.getBlob) return props.getBlob();
    const url = props.src();
    if (!url) return undefined;
    return (await platformFetch(url)).blob();
  };

  const copyToClipboard = async () => {
    try {
      const blob = await fetchBlob();
      if (!blob) throw new Error('No blob');
      if (isTouchDevice() && navigator.share) {
        await navigator.share({
          files: [new File([blob], 'image.png', { type: blob.type })],
          title: 'Share Image',
        });
        return;
      }
      if (ClipboardItem.supports(blob.type)) {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        toast.success('Copied to clipboard');
      } else {
        await navigator.clipboard.writeText(props.src() ?? '');
        toast.success('Copied image URL to clipboard');
      }
    } catch (err) {
      console.error('Share/clipboard operation failed:', err);
      try {
        const url = props.src();
        if (url) await navigator.clipboard.writeText(url);
        toast.success('Copied image URL to clipboard');
      } catch {
        toast.failure('Failed to copy image');
      }
    }
  };

  const downloadImage = async () => {
    try {
      const blob = await fetchBlob();
      if (!blob) throw new Error('No blob');
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `image-${props.imageId()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success('Downloaded image');
    } catch (err) {
      console.error('Download failed:', err);
      toast.failure('Failed to download image');
    }
  };

  // Tracks whether the user is mid-drag (used for cursor and click-to-zoom).
  let isDragging = false;

  const updateCursor = (engine: {
    scale: number;
    canvasElement: HTMLElement;
  }) => {
    const canvas = engine.canvasElement;
    if (isDragging && engine.scale > 1.01) {
      canvas.style.cursor = 'grab';
    } else if (engine.scale > 1.01) {
      canvas.style.cursor = 'zoom-out';
    } else {
      canvas.style.cursor = 'zoom-in';
    }
  };

  // Swipe-to-navigate state (used inside the touch override callbacks below)
  let swipeTouchStartX = 0;
  let swipeTouchEndX = 0;
  let isSwiping = false;
  let zoompinchHandlingTouch = false;

  const getEngine = createZoompinch(wrapperRef, {
    clampBounds: true,
    onUpdate: (engine) => updateCursor(engine),
    touch: {
      // At scale 1 on mobile with gallery nav: intercept single-finger swipes
      // for navigation. Otherwise fall through to zoompinch.
      onStart: (e, engine) => {
        const hasNav = props.onPrevious != null || props.onNext != null;
        const doSwipeDetection =
          isMobile() &&
          hasNav &&
          e.touches.length === 1 &&
          engine.scale <= 1.01;
        if (doSwipeDetection) {
          swipeTouchStartX = e.touches[0].clientX;
          isSwiping = false;
          zoompinchHandlingTouch = false;
        } else {
          engine.handleTouchstart(e);
          zoompinchHandlingTouch = true;
        }
      },
      onWindowMove: (e, engine) => {
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
        swipeTouchEndX = e.touches[0].clientX;
        if (Math.abs(swipeTouchStartX - e.touches[0].clientX) > 30)
          isSwiping = true;
        if (isSwiping) e.preventDefault();
      },
      onWindowEnd: (e, engine) => {
        if (zoompinchHandlingTouch) {
          engine.handleTouchend(e);
          zoompinchHandlingTouch = false;
          return;
        }
        if (isSwiping && engine.scale <= 1.01) {
          const diff = swipeTouchStartX - swipeTouchEndX;
          if (Math.abs(diff) > 50) {
            if (diff > 0) props.onNext?.();
            else props.onPrevious?.();
          }
        }
        isSwiping = false;
        swipeTouchStartX = 0;
        swipeTouchEndX = 0;
        zoompinchHandlingTouch = false;
      },
    },
  });

  // Keyboard nav + toolbar fade — active while the image wrapper is mounted
  createEffect(() => {
    const wrapper = wrapperRef();
    if (!wrapper) return;

    const hasNav = props.onPrevious != null || props.onNext != null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        props.onPrevious?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        props.onNext?.();
      }
    };
    if (hasNav) window.addEventListener('keydown', handleKeyDown);

    if (!isMobile()) {
      setTimeout(
        () => window.addEventListener('mousemove', handleMouseMove),
        500
      );

      // Track dragging so click-to-zoom and cursor stay in sync
      let isMouseDown = false;
      let mouseDownX = 0;
      let mouseDownY = 0;

      const handleMouseDown = (e: MouseEvent) => {
        isMouseDown = true;
        mouseDownX = e.clientX;
        mouseDownY = e.clientY;
        isDragging = false;
      };
      const handleWindowMouseMove = (e: MouseEvent) => {
        if (!isMouseDown) return;
        if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > 5) {
          isDragging = true;
        }
      };
      const handleWindowMouseUp = () => {
        isMouseDown = false;
        // Delay reset so the click event (which fires after mouseup) can still
        // read isDragging=true and suppress the zoom-out action.
        setTimeout(() => {
          isDragging = false;
          const engine = getEngine();
          if (engine) updateCursor(engine);
        }, 0);
      };

      // Click-to-zoom: zoom in at cursor position, or reset if already zoomed
      const handleClick = (e: MouseEvent) => {
        if (isDragging) return;
        const engine = getEngine();
        if (!engine) return;
        const b = engine.wrapperBounds;
        const relX = (e.clientX - b.x) / b.width;
        const relY = (e.clientY - b.y) / b.height;
        if (engine.scale <= 1.01) {
          engine.applyTransform(2.5, [relX, relY], [relX, relY]);
        } else {
          engine.applyTransform(1, [0.5, 0.5], [0.5, 0.5]);
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
      if (hasNav) window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      if (hideToolbarTimeout) clearTimeout(hideToolbarTimeout);
    });
  });

  // Reset zoom when navigating to a different image.
  createEffect(() => {
    props.src();
    untrack(() => getEngine())?.applyTransform(1, [0.5, 0.5], [0.5, 0.5]);
  });

  const navButtonClass =
    'absolute top-1/2 -translate-y-1/2 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-button transition-opacity duration-300';

  const navVisible = () => isTouchDevice() || isToolbarVisible();

  return (
    <div
      class="fixed inset-0 z-modal flex items-center justify-center"
      style={{
        'padding-top': 'max(var(--safe-top), 0.5rem)',
        'padding-bottom': 'max(var(--safe-bottom), 1.5rem)',
        'padding-left': 'max(var(--safe-left), 0.5rem)',
        'padding-right': 'max(var(--safe-right), 0.5rem)',
      }}
    >
      <Dialog.Content class="relative flex items-center justify-center w-full h-full sm:w-auto sm:h-auto bg-panel">
        {/* Toolbar */}
        <LightboxToolbar isVisible={isToolbarVisible()}>
          <DeprecatedIconButton
            icon={ClipboardIcon}
            theme="clear"
            onClick={copyToClipboard}
            onTouchEnd={copyToClipboard}
            tooltip={{ label: 'Copy image' }}
          />
          <DeprecatedIconButton
            icon={DownloadIcon}
            theme="clear"
            onClick={downloadImage}
            tooltip={{ label: 'Download image' }}
          />
          <Dialog.CloseButton>
            <DeprecatedIconButton
              icon={XIcon}
              theme="clear"
              tooltip={{ label: 'Close' }}
            />
          </Dialog.CloseButton>
        </LightboxToolbar>

        {/* Nav arrows — desktop only */}
        <Show when={!isMobile()}>
          <Show when={props.onPrevious}>
            <button
              class={cn(
                navButtonClass,
                'left-4',
                navVisible() ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{ 'z-index': stackingContext.zModal + 1 }}
              onClick={props.onPrevious}
              aria-label="Previous image"
            >
              <ChevronLeftIcon class="w-5 h-5 text-ink" />
            </button>
          </Show>
          <Show when={props.onNext}>
            <button
              class={cn(
                navButtonClass,
                'right-4',
                navVisible() ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{ 'z-index': stackingContext.zModal + 1 }}
              onClick={props.onNext}
              aria-label="Next image"
            >
              <ChevronRightIcon class="w-5 h-5 text-ink" />
            </button>
          </Show>
        </Show>

        {/* Index indicator */}
        <Show when={props.indexLabel}>
          <div
            class={cn(
              'absolute top-4 left-4 bg-dialog backdrop-blur-sm rounded-lg border border-edge px-3 py-1.5 shadow-md transition-opacity duration-300',
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
        <div class="w-full h-full flex items-center justify-center">
          <Show
            when={props.src()}
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge rounded-md bg-menu">
                <Spinner class="w-4 h-4 animate-spin" />
              </div>
            }
          >
            {/* Zoompinch wrapper — must contain a .canvas child */}
            <div
              ref={(el) => setWrapperRef(el)}
              class="w-full h-full relative overflow-hidden rounded-2xl"
              style={{ 'touch-action': 'none' }}
            >
              <div class="canvas w-full h-full will-change-transform">
                <img
                  class="w-full h-full sm:min-w-[200px] sm:max-h-[80vh] object-contain select-none"
                  src={props.src()}
                  alt="preview"
                />
              </div>
            </div>
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
      class="absolute top-4 right-4 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-1 flex flex-row items-center gap-1 shadow-md transition-opacity duration-300"
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
