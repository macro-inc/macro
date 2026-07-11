import { internalDrag } from '@core/directive/internalDragState';

false && internalDrag;

import { SERVER_HOSTS } from '@core/constant/servers';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { throwOnErr } from '@core/util/result';
import { Dialog } from '@kobalte/core/dialog';
import { constrainImageDimensions } from '@lexical-core/utils/media';
import ExpandIcon from '@phosphor/arrows-out-simple.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import ThreeDotsIcon from '@phosphor/dots-three-vertical.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { Button, cn, Dropdown } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import {
  copyImageToClipboard,
  downloadImage as downloadImageAction,
} from '../util/imageActions';
import { platformFetch } from '../util/platformFetch';
import { Lightbox } from './Lightbox';

type ImageData = {
  id: string;
  width?: string | number | undefined;
  height?: string | number | undefined;
};

/**
 * @deprecated Prefer the composable media primitives in `@channel/Media`.
 * Keep this only for legacy callers until they are migrated.
 */
type ImagePreviewProps = {
  image: ImageData;
  variant: 'small' | 'dynamic';
  square?: boolean;
  onDelete?: () => void;
  isContext?: boolean;
  isDss?: boolean;
  onError?: (err: any) => void;
};

const THEMES = {
  small:
    'size-15 object-cover rounded-2xl border border-edge hover:opacity-80 select-none',
  dynamic:
    'min-w-[100px] max-h-[80vh] object-contain w-full rounded-2xl select-none border border-edge hover:border-accent hover-transition-border',
};

// NOTE: copied logic from block-image
const getDssImageBlob = async (documentId: string) => {
  const documentResult = await throwOnErr(() =>
    fetchBinaryDocumentData(documentId)
  );
  // presigned url with expiry
  const { blobUrl } = documentResult;
  return throwOnErr(() => fetchBinary(blobUrl, 'blob'));
};

/** Max width for single image preview containers (matches MediaPreview max-w-[400px]) */
const SINGLE_IMAGE_MAX_WIDTH = 400;

function ImagePlaceholder(props: {
  dims: { width: number; height: number } | undefined;
}) {
  return (
    <div
      class="flex items-center justify-center border border-edge rounded-2xl bg-surface"
      style={
        props.dims
          ? {
              width: `${props.dims.width}px`,
              height: `${props.dims.height}px`,
            }
          : {
              width: '60px',
              height: '60px',
            }
      }
    >
      <Spinner class="size-4 animate-spin" />
    </div>
  );
}

/**
 * @deprecated Prefer the composable media primitives in `@channel/Media`.
 * Keep this only for legacy callers until they are migrated.
 */
export function ImagePreview(props: ImagePreviewProps) {
  const [imageBlob, setImageBlob] = createSignal<Blob>();
  const [objectUrl, setObjectUrl] = createSignal<string>();
  const [loaded, setLoaded] = createSignal(false);

  const scaledDimensions = () =>
    constrainImageDimensions(
      props.image.width,
      props.image.height,
      SINGLE_IMAGE_MAX_WIDTH
    );

  const sfsImageUrl = () => {
    if (props.isDss) {
      console.error('do not access sfs image url for dss images');
      return '';
    }
    return `${SERVER_HOSTS['static-file']}/file/${props.image.id}`;
  };

  const imageSrc = () => {
    if (props.isDss) return objectUrl();
    return sfsImageUrl();
  };

  // Load DSS image blob
  createEffect(() => {
    if (!props.isDss) return;

    getDssImageBlob(props.image.id)
      .then((blob) => {
        if (!blob) throw new Error('Failed to download DSS image');
        setImageBlob(blob);
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch((err) => {
        props.onError?.(err);
      });
  });

  onCleanup(() => {
    const url = objectUrl();
    if (url) URL.revokeObjectURL(url);
  });

  // Thumbnail menu actions
  const getBlob = (): Promise<Blob | undefined> => {
    if (props.isDss) return Promise.resolve(imageBlob());
    return platformFetch(sfsImageUrl()).then((r) => r.blob());
  };

  const copyToClipboard = () => copyImageToClipboard(getBlob, sfsImageUrl());
  const downloadImage = () => downloadImageAction(getBlob, props.image.id);

  return (
    <Dialog modal={true}>
      <div class="flex group relative">
        <Show when={props.variant !== 'small'}>
          <div class="group-hover:visible invisible absolute top-2 right-2 bg-surface rounded-2xl border border-edge flex flex-row items-center gap-1 z-10">
            <Dialog.Trigger disabled={props.isContext}>
              <Button variant="ghost" size="icon-md">
                <ExpandIcon />
              </Button>
            </Dialog.Trigger>
            <Dropdown>
              <Dropdown.Trigger
                variant="ghost"
                size="icon-md"
                disabled={props.isContext}
              >
                <ThreeDotsIcon />
              </Dropdown.Trigger>
              <Dropdown.Content>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={copyToClipboard}>
                    <ClipboardIcon class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Copy image</span>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={downloadImage}>
                    <DownloadIcon class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Download image</span>
                  </Dropdown.Item>
                </Dropdown.Group>
                <Show when={props.onDelete}>
                  <Dropdown.Group>
                    <Dropdown.Item onSelect={() => props.onDelete?.()}>
                      <TrashIcon class="size-4 shrink-0" />
                      <span class="flex-1 truncate">Delete image</span>
                    </Dropdown.Item>
                  </Dropdown.Group>
                </Show>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </Show>
        <Dialog.Trigger class="flex" disabled={props.isContext}>
          <Show when={!loaded()}>
            <ImagePlaceholder dims={scaledDimensions()} />
          </Show>
          <Show when={imageSrc()}>
            <img
              class={cn(
                THEMES[props.variant],
                'select-none',
                !loaded() && 'hidden'
              )}
              src={imageSrc()}
              alt="preview"
              width={scaledDimensions()?.width ?? props.image.width}
              height={scaledDimensions()?.height ?? props.image.height}
              style={{
                '-webkit-touch-callout': 'none',
                '-webkit-user-select': 'none',
                '-khtml-user-select': 'none',
                '-moz-user-select': 'none',
                '-ms-user-select': 'none',
                'user-select': 'none',
                ...(scaledDimensions()
                  ? {
                      'aspect-ratio': `${scaledDimensions()!.width} / ${scaledDimensions()!.height}`,
                      'max-width': `${scaledDimensions()!.width}px`,
                    }
                  : {}),
              }}
              draggable={!isTouchDevice()}
              onLoad={() => setLoaded(true)}
              use:internalDrag={true}
            />
          </Show>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
        <Lightbox
          src={imageSrc}
          imageId={() => props.image.id}
          getBlob={props.isDss ? () => Promise.resolve(imageBlob()) : undefined}
        />
      </Dialog.Portal>
    </Dialog>
  );
}
