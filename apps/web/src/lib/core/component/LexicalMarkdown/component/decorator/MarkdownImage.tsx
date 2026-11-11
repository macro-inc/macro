import { internalDrag } from '@core/directive/internalDragState';

false && internalDrag;

import { Lightbox } from '@core/component/Lightbox';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { displayImageUrl, isImageProxyUrl } from '@core/util/imageProxy';
import ImageIcon from '@icon/system/regular/image-broken.svg';
import LoadingSpinner from '@icon/system/regular/spinner.svg';
import { Dialog } from '@kobalte/core/dialog';
import type { ImageDecoratorProps } from '@macro-inc/lexical-core';
import { calculateEffectiveDimensions } from '@macro-inc/lexical-core/utils/media';
import { debounce } from '@solid-primitives/scheduled';
import { cn, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useDecoratorHost } from '../../decorator-host/use-decorator-host';
import { DRAG_DATA_FORMAT } from '../../plugins/draggable-block/draggableBlockPlugin';
import { getMediaUrl } from '../../plugins/media';
import { MediaButtons } from './MediaButtons';
import { MediaLoadingPlaceholder } from './MediaLoadingPlaceholder';
import { ResizeHandle } from './ResizeHandle';

type ImageState = 'loading' | 'ok' | 'error';

const ImageErrors = {
  UNAUTHORIZED: 'You do not have access to this image.',
  MISSING: 'This image does not exist.',
  GONE: 'This image has been deleted.',
  FALLBACK: 'This image could not be found.',
} as const;
type ImageError = keyof typeof ImageErrors;

function Spinner() {
  return (
    <div class="animate-spin size-5">
      <LoadingSpinner class="size-5" />
    </div>
  );
}

export function MarkdownImage(props: ImageDecoratorProps) {
  let imageRef!: HTMLImageElement;
  let containerRef!: HTMLDivElement;

  const host = useDecoratorHost();
  const interactable = host.isInteractable;

  const [viewerOpen, setViewerOpen] = createSignal(false);
  const [imageHover, setImageHover] = createSignal(false);
  const [uploading, setUploading] = createSignal(props.srcType === 'local');
  const [imageDims, setImageDims] = createSignal<[number, number]>([
    props.width || 0,
    props.height || 0,
  ]);
  const [imageUrl, setImageUrl] = createSignal('');
  const [state, setState] = createSignal<ImageState>('loading');
  const [imageError, setImageError] = createSignal<ImageError | undefined>();

  const [scale, setScale] = createSignal(props.scale);

  // Calculate effective dimensions from props
  const effectiveDims = createMemo(() => {
    const dims = calculateEffectiveDimensions(
      imageDims()[0],
      imageDims()[1],
      props.constrainedWidth,
      props.constrainedHeight
    );
    return [dims.width, dims.height] as [number, number];
  });

  createEffect(() => {
    if (props.srcType === 'local') {
      setImageUrl(props.url);
      return;
    }
    if (props.srcType === 'url') {
      // Public CORS-enabled media loads directly; other external hosts use
      // the proxy after GitHub blob links are rewritten to the raw file host.
      setImageUrl(displayImageUrl(props.url));
      return;
    }
    fireAndForget(
      getMediaUrl({
        type: props.srcType,
        id: props.id,
        url: props.url,
      }).then((maybeUrl) => {
        if (maybeUrl.isErr()) {
          setState('error');
          if (
            maybeUrl.isErr() &&
            maybeUrl.error.some((error) => error.code === 'UNAUTHORIZED')
          )
            setImageError('UNAUTHORIZED');
          else if (maybeUrl.error.some((error) => error.code === 'NOT_FOUND'))
            setImageError('MISSING');
          else if (
            maybeUrl.isErr() &&
            maybeUrl.error.some((error) => error.code === 'GONE')
          )
            setImageError('GONE');
          else setImageError('FALLBACK');
          return;
        }
        const url = maybeUrl.value;
        setImageUrl(url);
        if (props.srcType === 'dss') {
          host.image.upgradeUrl(props.key, url);
        }
      }),
      'markdown-media'
    );
  });

  const isSelectedAsNode = () => host.isSelected(props.key);
  const clickImageHandler = () => host.image.select(props.key);
  const deleteImage = () => host.image.remove(props.key);

  const viewFull = () => {
    if (state() === 'ok') {
      setViewerOpen(true);
    }
  };

  const loadImage = () => {
    setState('ok');
    setImageDims([imageRef.naturalWidth, imageRef.naturalHeight]);
    host.image.resize(props.key, imageRef.naturalWidth, imageRef.naturalHeight);
  };

  const onImageError = () => {
    if (imageUrl()) {
      // only set error if we looked for a real url
      setState('error');
    }
  };

  let cleanupListners = () => {};

  onMount(() => {
    imageRef.addEventListener('load', loadImage);
    imageRef.addEventListener('error', onImageError);
    cleanupListners = host.image.subscribeUploads(props.key, {
      start: () => setUploading(true),
      success: () => setUploading(false),
      failure: () => {
        setUploading(false);
        toast.failure('Failed to upload image');
      },
    });
    setTimeout(() => host.image.mounted(props.key), 10);
  });

  onCleanup(() => {
    imageRef.removeEventListener('load', loadImage);
    imageRef.removeEventListener('error', onImageError);
    cleanupListners();
  });

  const persistScale = debounce((value: number) => {
    host.image.persistScale(props.key, value);
  }, 60);
  createEffect(on(scale, persistScale));
  createEffect(() => {
    if (!interactable()) {
      persistScale.clear();
      const committedScale = host.image.readScale(props.key, props.scale);
      setScale(committedScale ?? props.scale);
    }
  });

  const debouncedSetHover = debounce((state: boolean) => {
    setImageHover(state);
  }, 300);

  return (
    <Dialog open={viewerOpen()} onOpenChange={setViewerOpen}>
      <div
        ref={containerRef}
        class={cn(
          'relative max-w-full my-4 grid place-items-center',
          isSelectedAsNode() && 'ring-3 ring-edge-muted',
          state() === 'error' && 'pattern-edge-muted pattern-diagonal-8',
          state() === 'error' && !effectiveDims()[0] && 'min-h-44',
          // If there are no constrained dimensions, center the image
          !props.constrainedWidth && !props.constrainedHeight && 'mx-auto',
          // Under a list item, sit at the item's text like Notion
          'in-[li]:mx-0 in-[li]:my-2'
        )}
        style={{
          width: effectiveDims()[0] ? '100%' : undefined,
          'max-width': `${effectiveDims()[0] ? effectiveDims()[0] * scale() : 640}px`,
          'aspect-ratio':
            effectiveDims()[0] && effectiveDims()[1]
              ? `${effectiveDims()[0] / effectiveDims()[1]}`
              : 'auto',
        }}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          clickImageHandler();
        }}
        onDblClick={(e: MouseEvent) => {
          e.preventDefault();
          viewFull();
        }}
        onMouseEnter={() => {
          debouncedSetHover(true);
        }}
        onMouseLeave={() => {
          debouncedSetHover.clear();
          setImageHover(false);
        }}
      >
        <Show when={state() === 'ok' && interactable()}>
          <ResizeHandle
            scale={scale}
            setScale={(value) => {
              if (interactable() && host.isEditable()) setScale(value);
            }}
            side="left"
            imageDims={effectiveDims}
            containerRef={containerRef}
          />
          <ResizeHandle
            scale={scale}
            setScale={(value) => {
              if (interactable() && host.isEditable()) setScale(value);
            }}
            side="right"
            imageDims={effectiveDims}
            containerRef={containerRef}
          />
        </Show>
        <img
          crossorigin={
            isImageProxyUrl(imageUrl()) ? 'use-credentials' : 'anonymous'
          }
          class={cn(
            'h-full object-contain',
            effectiveDims()[0] > 0 && 'absolute inset-0 size-full',
            (state() === 'loading' || state() === 'error') && 'invisible',
            state() === 'loading' &&
              !effectiveDims()[0] &&
              'absolute inset-0 size-0'
          )}
          draggable={true}
          use:internalDrag={true}
          onDragStart={(e) => {
            // Dropped in this editor the image moves; anywhere else it is
            // copied from its URL.
            if (interactable() && host.isEditable())
              e.dataTransfer?.setData(DRAG_DATA_FORMAT, props.key);
          }}
          ref={imageRef}
          src={imageUrl()}
          style={{
            width: effectiveDims()[0] ? '100%' : 'auto',
          }}
        />

        <Show when={state() === 'error'}>
          <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted">
            <ImageIcon class="size-5" />
            <div>{ImageErrors[imageError() ?? 'FALLBACK']}</div>
          </div>
        </Show>

        <Show when={state() === 'loading'}>
          <Show
            when={effectiveDims()[0] > 0}
            fallback={
              <MediaLoadingPlaceholder kind="image" label={props.alt} />
            }
          >
            <div class="absolute top-0 left-0 size-full flex flex-col justify-center items-center gap-2 text-ink-extra-muted bg-hover/50">
              <Spinner />
            </div>
          </Show>
        </Show>

        <Show when={uploading() && state() !== 'error'}>
          <div class="absolute flex gap-2 top-2 left-2 justify-center items-center p-2">
            <Spinner />
            Saving Image...
          </div>
        </Show>

        <Show
          when={
            (isSelectedAsNode() || imageHover()) &&
            (state() === 'ok' || state() === 'error')
          }
        >
          <Layer depth={3}>
            <div class="size-full absolute top-0 left-0 pointer-events-none bg-edge/10" />
            <MediaButtons
              delete={interactable() ? deleteImage : undefined}
              enlarge={state() === 'ok' ? viewFull : undefined}
              newTab={
                state() === 'ok'
                  ? () => {
                      window.open(imageUrl(), '_blank');
                    }
                  : undefined
              }
              containerRef={containerRef}
            />
          </Layer>
        </Show>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal scrim-glass" />
        <Lightbox
          src={imageUrl}
          crossOrigin={
            isImageProxyUrl(imageUrl()) ? 'use-credentials' : 'anonymous'
          }
          imageId={() => props.id}
          navigationHidden
        />
      </Dialog.Portal>
    </Dialog>
  );
}
