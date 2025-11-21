import { SERVER_HOSTS } from '@core/constant/servers';
import * as stackingContext from '@core/constant/stackingContext';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { maybeThrow } from '@core/util/maybeResult';
import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';
import ThreeDotsIcon from '@icon/regular/dots-three-vertical.svg';
import DownloadIcon from '@icon/regular/download-simple.svg';
import TrashIcon from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Panzoom from '@panzoom/panzoom';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { platformFetch } from '../util/platformFetch';
import { IconButton } from './IconButton';
import { DropdownMenuContent, MenuItem, MenuSeparator } from './Menu';
import { toast } from './Toast/Toast';

export type ImagePreviewProps = {
  id: string;
  variant: 'small' | 'dynamic';
  square?: boolean;
  channelId?: string;
  messageId?: string;
  attachmentId?: string;
  isCurrentUser: boolean;
  content?: string;
  isContext?: boolean;
  isDss?: boolean;
  onError?: (err: any) => void;
};

const THEMES = {
  small:
    'size-15 object-cover rounded-2xl border border-edge hover:opacity-80 select-none',
  dynamic:
    'min-w-[100px] max-h-[80vh] object-contain w-full rounded-2xl select-none border border-edge hover:border-accent hover-transition-border',
  expanded:
    'max-w-full w-full h-full sm:min-w-[200px] sm:max-h-[80vh] object-contain rounded-2xl select-none',
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
  const [imageRef, setImageRef] = createSignal<HTMLImageElement | undefined>();
  const [isToolbarVisible, setIsToolbarVisible] = createSignal(false);
  let hideToolbarTimeout: number | undefined;

  const [imageBlob, setImageBlob] = createSignal<Blob>();
  const [objectUrl, setObjectUrl] = createSignal<string>();

  const sfsImageUrl = () => {
    if (props.isDss) {
      console.error('do not access sfs image url for dss images');
      return '';
    }
    return `${SERVER_HOSTS['static-file']}/file/${props.id}`;
  };

  const imageSrc = () => {
    if (props.isDss) {
      return objectUrl();
    }
    return sfsImageUrl();
  };

  // download DSS image
  createEffect(() => {
    if (!props.isDss) return;

    getDssImageBlob(props.id)
      .then((blob) => {
        if (!blob) {
          throw new Error('Failed to download DSS image');
        }
        setImageBlob(blob);
        const url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((err) => {
        props.onError?.(err);
      });
  });

  onCleanup(() => {
    const url = objectUrl();
    if (!url) return;
    URL.revokeObjectURL(url);
  });

  const downloadImage = async () => {
    const blobUrl = async () => {
      if (props.isDss) {
        return objectUrl();
      }
      const response = await platformFetch(sfsImageUrl());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      return url;
    };

    try {
      const url = await blobUrl();
      if (!url) throw new Error('No blob url');
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${props.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Downloaded image');
    } catch (err) {
      console.error('Download failed:', err);
      toast.failure('Failed to download image');
    }
  };

  const showDeleteMediaButton = () => {
    return (
      props.channelId &&
      props.messageId &&
      props.attachmentId &&
      props.isCurrentUser
    );
  };

  const handleDeleteChannelMedia = async () => {
    if (!props.channelId || !props.messageId || !props.attachmentId) return;
    await commsServiceClient.patchMessage({
      channel_id: props.channelId,
      message_id: props.messageId,
      content: props.content,
      attachment_ids_to_delete: [props.attachmentId],
    });
  };

  const handleMouseMove = () => {
    if (isMobileWidth() || isTouchDevice) return;

    setIsToolbarVisible(true);

    if (hideToolbarTimeout) {
      clearTimeout(hideToolbarTimeout);
    }

    hideToolbarTimeout = setTimeout(() => {
      setIsToolbarVisible(false);
    }, 1000) as unknown as number;
  };

  const copyToClipboard = async () => {
    const getBlob = async () => {
      if (props.isDss) {
        return imageBlob();
      }

      const response = await platformFetch(sfsImageUrl());
      const blob = await response.blob();
      return blob;
    };

    const copyUrlFallback = async () => {
      try {
        await navigator.clipboard.writeText(sfsImageUrl());
        toast.success('Copied image URL to clipboard');
      } catch {
        toast.failure('Failed to copy image');
      }
    };

    const copyBlobToClipboard = async (blob: Blob) => {
      const isSupported = ClipboardItem.supports(blob.type);
      if (isSupported) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ]);
        toast.success('Copied to clipboard');
      } else {
        await navigator.clipboard.writeText(sfsImageUrl());
        toast.success('Copied image URL to clipboard');
      }
    };

    try {
      const blob = await getBlob();
      if (!blob) throw new Error('No blob');

      if (isTouchDevice && navigator.share) {
        const file = new File([blob], 'image.png', { type: blob.type });
        await navigator.share({
          files: [file],
          title: 'Share Image',
        });
      } else {
        await copyBlobToClipboard(blob);
      }
    } catch (err) {
      console.error('Share/clipboard operation failed:', err);
      await copyUrlFallback();
    }
  };

  let removePanzoomEventListener: () => void = () => {};
  createEffect(() => {
    const image = imageRef();
    if (!image) {
      removePanzoomEventListener();
      return;
    }

    setIsToolbarVisible(false);

    const panzoom = Panzoom(image, {
      maxScale: 5,
      contain: 'outside',
      startScale: 1,
      cursor: 'var(--cursor-default)',
    });

    const updateCursor = () => {
      const scale = panzoom.getScale();
      if (scale <= 1.01) {
        image.style.cursor = 'var(--cursor-default)';
      } else {
        image.style.cursor = 'var(--cursor-grab)';
      }
    };

    removePanzoomEventListener = () => {
      panzoom.destroy();
      image.removeEventListener('wheel', panzoom.zoomWithWheel);
      image.removeEventListener('panzoomchange', updateCursor);
    };

    image.addEventListener('panzoomchange', updateCursor);
    image.addEventListener('wheel', panzoom.zoomWithWheel);

    if (!isMobileWidth() && !isTouchDevice) {
      setTimeout(() => {
        window.addEventListener('mousemove', handleMouseMove);
      }, 500);
    }

    onCleanup(() => {
      removePanzoomEventListener();
      window.removeEventListener('mousemove', handleMouseMove);

      if (hideToolbarTimeout) {
        clearTimeout(hideToolbarTimeout);
      }
    });
  });

  return (
    <Dialog modal={true}>
      <div class="flex group relative">
        <Show when={props.variant !== 'small'}>
          <div class="group-hover:visible invisible absolute top-2 right-2 bg-button rounded-2xl border border-edge flex flex-row items-center gap-1 z-10">
            <Dialog.Trigger disabled={props.isContext}>
              <IconButton icon={ExpandIcon} theme="clear" />
            </Dialog.Trigger>
            <DropdownMenu>
              <DropdownMenu.Trigger disabled={props.isContext}>
                <IconButton icon={ThreeDotsIcon} theme="clear" />
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
                  <Show when={showDeleteMediaButton()}>
                    <MenuSeparator />
                    <MenuItem
                      text="Delete image"
                      icon={TrashIcon}
                      onClick={handleDeleteChannelMedia}
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
              // Prevent long press on image ios behavior
              style={{
                '-webkit-touch-callout': 'none',
                '-webkit-user-select': 'none',
                '-khtml-user-select': 'none',
                '-moz-user-select': 'none',
                '-ms-user-select': 'none',
                'user-select': 'none',
              }}
              draggable={!isTouchDevice}
            />
          </Show>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay backdrop-blur-md" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center p-2 pb-6 sm:p-12">
          <Dialog.Content
            class="relative flex items-center justify-center w-full h-full sm:w-auto sm:h-auto"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div
              class="absolute top-4 right-4 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-1 flex flex-row items-center gap-1 shadow-md transition-opacity duration-300"
              classList={{
                'opacity-100':
                  isMobileWidth() || isTouchDevice || isToolbarVisible(),
                'opacity-0 pointer-events-none':
                  !isMobileWidth() && !isTouchDevice && !isToolbarVisible(),
              }}
              style={{ 'z-index': stackingContext.zModal + 1 }}
            >
              <IconButton
                icon={ClipboardIcon}
                theme="clear"
                onClick={copyToClipboard}
                onTouchEnd={copyToClipboard}
                tooltip={{ label: 'Copy image' }}
              />
              <IconButton
                icon={DownloadIcon}
                theme="clear"
                onClick={downloadImage}
                tooltip={{ label: 'Download image' }}
              />
              <Dialog.CloseButton>
                <IconButton
                  icon={XIcon}
                  theme="clear"
                  tooltip={{ label: 'Close' }}
                />
              </Dialog.CloseButton>
            </div>
            <div class="w-full h-full flex items-center justify-center rounded-2xl overflow-visible">
              <Show
                when={imageSrc()}
                fallback={
                  <div class="flex flex-col items-center justify-center gap-2 w-[60px] h-[60px] border border-edge rounded-md bg-menu">
                    <Spinner class="w-4 h-4 animate-spin" />
                  </div>
                }
              >
                <img
                  ref={(el) => {
                    setImageRef(el);
                  }}
                  class={THEMES['expanded']}
                  src={imageSrc()}
                  alt="preview"
                />
              </Show>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
