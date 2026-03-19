import { SERVER_HOSTS } from '@core/constant/servers';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { maybeThrow } from '@core/util/maybeResult';
import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';
import ThreeDotsIcon from '@icon/regular/dots-three-vertical.svg';
import DownloadIcon from '@icon/regular/download-simple.svg';
import TrashIcon from '@icon/regular/trash.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import {
  copyImageToClipboard,
  downloadImage as downloadImageAction,
} from '../util/imageActions';
import { platformFetch } from '../util/platformFetch';
import { DeprecatedIconButton } from './DeprecatedIconButton';
import { Lightbox } from './Lightbox';
import { DropdownMenuContent, MenuItem, MenuSeparator } from './Menu';

type ImageData = {
  id: string;
  width?: string | number | undefined;
  height?: string | number | undefined;
};

export type ImagePreviewProps = {
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
  const maybeDocument = await storageServiceClient.getBinaryDocument({
    documentId,
  });
  const documentResult = maybeThrow(maybeDocument);
  // presigned url with expiry
  const { blobUrl } = documentResult;
  const blobResult = await fetchBinary(blobUrl, 'blob');
  const blob = maybeThrow(blobResult);
  return blob;
};

export function ImagePreview(props: ImagePreviewProps) {
  const [imageBlob, setImageBlob] = createSignal<Blob>();
  const [objectUrl, setObjectUrl] = createSignal<string>();

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
          <div class="group-hover:visible invisible absolute top-2 right-2 bg-button rounded-2xl border border-edge flex flex-row items-center gap-1 z-10">
            <Dialog.Trigger disabled={props.isContext}>
              <DeprecatedIconButton icon={ExpandIcon} theme="clear" />
            </Dialog.Trigger>
            <DropdownMenu>
              <DropdownMenu.Trigger disabled={props.isContext}>
                <DeprecatedIconButton icon={ThreeDotsIcon} theme="clear" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <div class="fixed inset-0 z-modal-overlay bg-transparent" />
                <DropdownMenuContent class="z-modal">
                  <MenuItem
                    text="Copy image"
                    icon={ClipboardIcon}
                    onClick={copyToClipboard}
                  />
                  <MenuItem
                    text="Download image"
                    icon={DownloadIcon}
                    onClick={downloadImage}
                  />
                  <Show when={props.onDelete}>
                    <MenuSeparator />
                    <MenuItem
                      text="Delete image"
                      icon={TrashIcon}
                      onClick={() => props.onDelete?.()}
                    />
                  </Show>
                </DropdownMenuContent>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </Show>
        <Dialog.Trigger class="flex" disabled={props.isContext}>
          <Show
            when={imageSrc()}
            fallback={
              <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge rounded-md bg-menu">
                <Spinner class="w-4 h-4 animate-spin" />
              </div>
            }
          >
            <img
              class={`${THEMES[props.variant]} select-none`}
              src={imageSrc()}
              alt="preview"
              width={props.image.width}
              height={props.image.height}
              style={{
                '-webkit-touch-callout': 'none',
                '-webkit-user-select': 'none',
                '-khtml-user-select': 'none',
                '-moz-user-select': 'none',
                '-ms-user-select': 'none',
                'user-select': 'none',
              }}
              draggable={!isTouchDevice()}
              onDragStart={(e) => {
                e.dataTransfer?.setData('application/x-macro-internal', '1');
              }}
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
