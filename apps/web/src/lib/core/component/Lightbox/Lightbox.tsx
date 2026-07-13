import { Dialog, useDialogContext } from '@kobalte/core/dialog';
import ClipboardIcon from '@phosphor/clipboard.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import XIcon from '@phosphor/x.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { Button, cn } from '@ui';
import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  type JSX,
  Show,
  untrack,
} from 'solid-js';
import { Zoompinch, type ZoompinchHandle } from '../Zoompinch';
import { createGestures } from './createGestures';
import { createImageActions } from './createImageActions';
import { createMomentum } from './createMomentum';
import { createZoomModel } from './createZoomModel';
import { LightboxChrome } from './LightboxChrome';
import { LightboxToolbar } from './LightboxToolbar';

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

  const images = createImageActions(props);
  const zoom = createZoomModel(zoompinchHandle);
  const momentum = createMomentum(zoompinchHandle);
  const gestures = createGestures({
    zoompinchHandle,
    totalZoom: zoom.totalZoom,
    currentScale: zoom.currentScale,
    applyZoom: zoom.applyZoom,
    momentum,
    onPrevious: () => props.onPrevious?.(),
    onNext: () => props.onNext?.(),
    onClose: () => dialogContext.close(),
  });

  // Reset zoom + kill any in-flight glide when navigating to a different image.
  createEffect(() => {
    props.src();
    untrack(() => {
      momentum.cancelMomentum();
      zoom.resetZoom();
    });
  });

  return (
    <div
      ref={zoom.setContainer}
      class="fixed inset-0 z-modal flex items-center justify-center"
      style={{
        'margin-top': 'max(var(--safe-top), 0.5rem)',
        'margin-bottom': 'max(var(--safe-bottom), 1.5rem)',
        'margin-left': 'max(var(--safe-left), 0.5rem)',
        'margin-right': 'max(var(--safe-right), 0.5rem)',
      }}
    >
      <Dialog.Content
        aria-label="Lightbox image viewer"
        class="flex items-center justify-center bg-surface rounded-md overflow-hidden"
      >
        <LightboxToolbar isVisible={true}>
          <Button
            variant="ghost"
            size="icon-md"
            onClick={images.copyToClipboard}
            disabled={images.isBusy() || images.isPrefetching()}
            label="Copy image"
          >
            {images.isCopying() ? <SpinnerIcon /> : <ClipboardIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-md"
            onClick={images.downloadImage}
            disabled={images.isBusy() || images.isPrefetching()}
            label="Download image"
          >
            {images.isDownloading() ? <SpinnerIcon /> : <DownloadIcon />}
          </Button>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-md"
            label="Close"
          >
            <XIcon />
          </Dialog.CloseButton>
        </LightboxToolbar>

        <LightboxChrome
          onPrevious={props.onPrevious}
          onNext={props.onNext}
          navigationHidden={props.navigationHidden}
          indexLabel={props.indexLabel}
        />

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
              onUpdate={zoom.onEngineUpdate}
              onWheel={zoom.handleWheel}
              touch={gestures.touch}
              class={cn(
                'relative overflow-hidden',
                !zoom.cardSize() && 'size-full'
              )}
              style={{
                cursor: gestures.cursor(),
                ...(zoom.cardSize() && {
                  width: `${zoom.cardSize()!.w}px`,
                  height: `${zoom.cardSize()!.h}px`,
                }),
              }}
              // Give the canvas the image's own aspect ratio so the engine's
              // contain-fit and clamping track the image content, not the
              // (possibly differently-shaped) card.
              canvasStyle={
                zoom.baseSize()
                  ? {
                      width: `${zoom.baseSize()!.w}px`,
                      height: `${zoom.baseSize()!.h}px`,
                    }
                  : undefined
              }
            >
              <img
                class="size-full sm:min-w-50 sm:max-h-[80vh] object-contain select-none"
                style={{ '-webkit-touch-callout': 'none' }}
                src={props.src()}
                alt="preview"
                onLoad={(e) => zoom.handleImageLoad(e.currentTarget)}
              />
            </Zoompinch>
          </Show>
        </div>
      </Dialog.Content>
    </div>
  );
}
