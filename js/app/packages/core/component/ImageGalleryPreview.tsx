import { SERVER_HOSTS } from '@core/constant/servers';
import * as stackingContext from '@core/constant/stackingContext';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import ChevronLeftIcon from '@icon/regular/caret-left.svg';
import ChevronRightIcon from '@icon/regular/caret-right.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';
import ThreeDotsIcon from '@icon/regular/dots-three-vertical.svg';
import DownloadIcon from '@icon/regular/download-simple.svg';
import TrashIcon from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { commsServiceClient } from '@service-comms/client';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { platformFetch } from '../util/platformFetch';
import { IconButton } from './IconButton';
import { DropdownMenuContent, MenuItem, MenuSeparator } from './Menu';
import { toast } from './Toast/Toast';

export type ImageGalleryPreviewProps = {
  ids: string[];
  initialIndex?: number;
  variant: 'small' | 'dynamic';
  square?: boolean;
  wrapperClass?: string;
  channelId?: string;
  messageId?: string;
  attachmentIds: string[];
  isCurrentUser: boolean;
  content?: string;
  isContext?: boolean;
};

const THEMES = {
  small:
    'size-15 object-cover rounded-2xl border border-edge hover:opacity-80 select-none',
  dynamic:
    'min-w-[100px] max-h-[200px] object-contain w-full rounded-2xl select-none border border-edge hover:border-accent hover-transition-border',
  expanded:
    'max-w-full w-full h-full sm:min-w-[200px] sm:max-h-[80vh] object-contain rounded-2xl select-none',
};

export const ImageGalleryPreview: Component<ImageGalleryPreviewProps> = (
  props
) => {
  const [currentIndex, setCurrentIndex] = createSignal(props.initialIndex ?? 0);
  const [imageRef, setImageRef] = createSignal<HTMLImageElement | undefined>();
  const [clickedIndex, setClickedIndex] = createSignal(0);
  const [isDialogOpen, setIsDialogOpen] = createSignal(false);
  const [panzoomInstance, setPanzoomInstance] =
    createSignal<PanzoomObject | null>(null);
  const [isToolbarVisible, setIsToolbarVisible] = createSignal(false);
  let hideToolbarTimeout: number | undefined;

  // Touch gesture state for swipe detection
  const [touchStartX, setTouchStartX] = createSignal(0);
  const [touchEndX, setTouchEndX] = createSignal(0);
  const [isSwiping, setIsSwiping] = createSignal(false);

  const currentImageUrl = (): string => {
    const id = props.ids[currentIndex()];
    return `${SERVER_HOSTS['static-file']}/file/${id}`;
  };

  const getImageUrl = (id: string): string => {
    return `${SERVER_HOSTS['static-file']}/file/${id}`;
  };

  const hasNext = () => currentIndex() < props.ids.length - 1;
  const hasPrevious = () => currentIndex() > 0;

  const navigateNext = () => {
    if (hasNext()) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const navigatePrevious = () => {
    if (hasPrevious()) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (!isMobileWidth() || !isTouchDevice) return;
    setTouchStartX(e.touches[0].clientX);
    setIsSwiping(false);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isMobileWidth() || !isTouchDevice) return;
    setTouchEndX(e.touches[0].clientX);

    const diffX = Math.abs(touchStartX() - e.touches[0].clientX);
    if (diffX > 30) {
      setIsSwiping(true);
    }
  };

  const handleTouchEnd = () => {
    if (!isMobileWidth() || !isTouchDevice || !isSwiping()) return;

    const swipeThreshold = 50;
    const diff = touchStartX() - touchEndX();

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        navigateNext();
      } else {
        navigatePrevious();
      }
    }

    setIsSwiping(false);
    setTouchStartX(0);
    setTouchEndX(0);
  };

  const downloadImage = async () => {
    try {
      const response = await platformFetch(currentImageUrl());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${props.ids[currentIndex()]}.png`;
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

  const downloadImageById = async (id: string) => {
    try {
      const response = await platformFetch(getImageUrl(id));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${id}.png`;
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
    if (isTouchDevice) {
      try {
        const blob = await platformFetch(currentImageUrl()).then((res) =>
          res.blob()
        );
        const file = new File([blob], 'image.png', { type: blob.type });

        if (navigator.share) {
          await navigator.share({
            files: [file],
            title: 'Share Image',
          });
        } else {
          // Fallback to clipboard methods when share is not available
          const isSupported = ClipboardItem.supports(blob.type);
          if (isSupported) {
            await navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob,
              }),
            ]);
            toast.success('Copied to clipboard');
          } else {
            await navigator.clipboard.writeText(currentImageUrl());
            toast.success('Copied image URL to clipboard');
          }
        }
      } catch (err) {
        console.error('Share/clipboard operation failed:', err);
        try {
          await navigator.clipboard.writeText(currentImageUrl());
          toast.success('Copied image URL to clipboard');
        } catch {
          toast.failure('Failed to copy image');
        }
      }
    } else {
      try {
        const response = await platformFetch(currentImageUrl());
        const blob = await response.blob();

        const isSupported = ClipboardItem.supports(blob.type);

        if (isSupported) {
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob,
            }),
          ]);
          toast.success('Copied to clipboard');
        } else {
          await navigator.clipboard.writeText(currentImageUrl());
          toast.success('Copied image URL to clipboard');
        }
      } catch (err) {
        console.error('Clipboard operation failed:', err);
        try {
          await navigator.clipboard.writeText(currentImageUrl());
          toast.success('Copied image URL to clipboard');
        } catch {
          toast.failure('Failed to copy image');
        }
      }
    }
  };

  const copyToClipboardById = async (id: string) => {
    if (isTouchDevice) {
      try {
        const blob = await platformFetch(getImageUrl(id)).then((res) =>
          res.blob()
        );
        const file = new File([blob], 'image.png', { type: blob.type });
        if (navigator.share) {
          await navigator.share({ files: [file], title: 'Share Image' });
        } else {
          const isSupported = ClipboardItem.supports(blob.type);
          if (isSupported) {
            await navigator.clipboard.write([
              new ClipboardItem({ [blob.type]: blob }),
            ]);
            toast.success('Copied to clipboard');
          } else {
            await navigator.clipboard.writeText(getImageUrl(id));
            toast.success('Copied image URL to clipboard');
          }
        }
      } catch (err) {
        console.error('Share/clipboard operation failed:', err);
        try {
          await navigator.clipboard.writeText(getImageUrl(id));
          toast.success('Copied image URL to clipboard');
        } catch {
          toast.failure('Failed to copy image');
        }
      }
    } else {
      try {
        const response = await platformFetch(getImageUrl(id));
        const blob = await response.blob();
        const isSupported = ClipboardItem.supports(blob.type);
        if (isSupported) {
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob }),
          ]);
          toast.success('Copied to clipboard');
        } else {
          await navigator.clipboard.writeText(getImageUrl(id));
          toast.success('Copied image URL to clipboard');
        }
      } catch (err) {
        console.error('Clipboard operation failed:', err);
        try {
          await navigator.clipboard.writeText(getImageUrl(id));
          toast.success('Copied image URL to clipboard');
        } catch {
          toast.failure('Failed to copy image');
        }
      }
    }
  };

  // let panzoomCleanup: (() => void) | null = null;

  createEffect(() => {
    const image = imageRef();
    const dialogOpen = isDialogOpen();

    if (!image || !dialogOpen) {
      return;
    }

    setIsToolbarVisible(false);

    const panzoom = Panzoom(image, {
      maxScale: 5,
      contain: 'outside',
      startScale: 1,
      cursor: 'default',
    });

    setPanzoomInstance(panzoom);

    const updateCursor = () => {
      const scale = panzoom.getScale();
      if (scale <= 1.01) {
        image.style.cursor = 'default';
      } else {
        image.style.cursor = 'grab';
      }
    };

    const handleWheel = (e: WheelEvent) => {
      panzoom.zoomWithWheel(e);
    };

    image.addEventListener('panzoomchange', updateCursor);
    image.addEventListener('wheel', handleWheel);

    // Navigation with keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    if (!isMobileWidth() && !isTouchDevice) {
      setTimeout(() => {
        window.addEventListener('mousemove', handleMouseMove);
      }, 500);
    }

    const handleTouchStartWrapper = (e: TouchEvent) => {
      const scale = panzoom.getScale();
      if (scale <= 1.01) {
        handleTouchStart(e);
      }
    };

    const handleTouchMoveWrapper = (e: TouchEvent) => {
      const scale = panzoom.getScale();
      if (scale <= 1.01) {
        handleTouchMove(e);
        if (isSwiping()) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEndWrapper = () => {
      const scale = panzoom.getScale();
      if (scale <= 1.01) {
        handleTouchEnd();
      }
    };

    if (isMobileWidth() && isTouchDevice) {
      image.addEventListener('touchstart', handleTouchStartWrapper, {
        passive: true,
      });
      image.addEventListener('touchmove', handleTouchMoveWrapper, {
        passive: false,
      });
      image.addEventListener('touchend', handleTouchEndWrapper, {
        passive: true,
      });
    }

    onCleanup(() => {
      panzoom.destroy();
      image.removeEventListener('panzoomchange', updateCursor);
      image.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);

      if (hideToolbarTimeout) {
        clearTimeout(hideToolbarTimeout);
      }

      if (isMobileWidth() && isTouchDevice) {
        image.removeEventListener('touchstart', handleTouchStartWrapper);
        image.removeEventListener('touchmove', handleTouchMoveWrapper);
        image.removeEventListener('touchend', handleTouchEndWrapper);
      }
    });
  });

  createEffect(() => {
    if (!isDialogOpen()) return;
    currentIndex(); //force re-render

    panzoomInstance()?.reset({ animate: false });
  });

  const handleDeleteMedia = async (attachmentId: string) => {
    console.log('deleting media 2', attachmentId);
    if (!props.channelId || !props.messageId) return;
    await commsServiceClient.patchMessage({
      channel_id: props.channelId,
      message_id: props.messageId,
      attachment_ids_to_delete: [attachmentId],
      content: props.content,
    });
  };

  return (
    <Dialog
      modal={true}
      onOpenChange={(isOpen) => {
        setIsDialogOpen(isOpen);
        if (isOpen) {
          setCurrentIndex(clickedIndex());
        } else {
          setClickedIndex(0);
        }
      }}
    >
      <div class={props.wrapperClass ?? 'flex flex-row flex-wrap gap-2'}>
        <For each={props.ids}>
          {(id, index) => (
            <div
              class={props.variant === 'dynamic' ? 'max-w-[200px] w-fit' : ''}
            >
              <div class="flex group relative">
                <Show when={props.variant !== 'small'}>
                  <div class="group-hover:visible invisible absolute top-2 right-2 bg-button rounded-2xl border border-edge flex flex-row items-center gap-1 z-10">
                    <Dialog.Trigger
                      onClick={() => setClickedIndex(index())}
                      disabled={props.isContext}
                    >
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
                            onClick={() => copyToClipboardById(id)}
                          />
                          <MenuItem
                            text="Download image"
                            icon={DownloadIcon}
                            onClick={() => downloadImageById(id)}
                          />
                          <Show when={props.isCurrentUser}>
                            <MenuSeparator />
                            <MenuItem
                              text="Delete image"
                              icon={TrashIcon}
                              onClick={() =>
                                handleDeleteMedia(props.attachmentIds[index()])
                              }
                            />
                          </Show>
                        </DropdownMenuContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu>
                  </div>
                </Show>
                <Dialog.Trigger
                  class="flex"
                  onClick={() => setClickedIndex(index())}
                  disabled={props.isContext}
                >
                  <img
                    class={`${THEMES[props.variant]} select-none`}
                    src={getImageUrl(id)}
                    alt="preview"
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
                </Dialog.Trigger>
              </div>
            </div>
          )}
        </For>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay backdrop-blur-md" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center p-2 pb-6 sm:p-12">
          <Dialog.Content
            class="relative flex items-center justify-center w-full h-full sm:w-auto sm:h-auto"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {/* Top toolbar */}
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

            {/* Navigation arrows */}
            <Show when={!isMobileWidth() || !isTouchDevice}>
              <Show when={props.ids.length > 1 && hasPrevious()}>
                <button
                  class="absolute left-4 top-1/2 -translate-y-1/2 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-button transition-opacity duration-300"
                  classList={{
                    'opacity-100':
                      isMobileWidth() || isTouchDevice || isToolbarVisible(),
                    'opacity-0 pointer-events-none':
                      !isMobileWidth() && !isTouchDevice && !isToolbarVisible(),
                  }}
                  style={{ 'z-index': stackingContext.zModal + 1 }}
                  onClick={navigatePrevious}
                  aria-label="Previous image"
                >
                  <ChevronLeftIcon class="w-5 h-5 text-ink" />
                </button>
              </Show>

              <Show when={props.ids.length > 1 && hasNext()}>
                <button
                  class="absolute right-4 top-1/2 -translate-y-1/2 bg-dialog backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-button transition-opacity duration-300"
                  classList={{
                    'opacity-100':
                      isMobileWidth() || isTouchDevice || isToolbarVisible(),
                    'opacity-0 pointer-events-none':
                      !isMobileWidth() && !isTouchDevice && !isToolbarVisible(),
                  }}
                  style={{ 'z-index': stackingContext.zModal + 1 }}
                  onClick={navigateNext}
                  aria-label="Next image"
                >
                  <ChevronRightIcon class="w-5 h-5 text-ink" />
                </button>
              </Show>
            </Show>

            {/* Navigation indicator */}
            <Show when={props.ids.length > 1}>
              <div
                class="absolute top-4 left-4 bg-dialog backdrop-blur-sm rounded-lg border border-edge px-3 py-1.5 shadow-md transition-opacity duration-300"
                classList={{
                  'opacity-100':
                    isMobileWidth() || isTouchDevice || isToolbarVisible(),
                  'opacity-0 pointer-events-none':
                    !isMobileWidth() && !isTouchDevice && !isToolbarVisible(),
                }}
                style={{ 'z-index': stackingContext.zModal + 1 }}
              >
                <span class="text-sm text-ink font-medium">
                  {currentIndex() + 1}/{props.ids.length}
                </span>
              </div>
            </Show>

            {/* Image container */}
            <div class="w-full h-full flex items-center justify-center rounded-2xl overflow-visible">
              <img
                ref={(el) => {
                  setImageRef(el);
                }}
                class={`${THEMES['expanded']} transition-opacity duration-150`}
                src={currentImageUrl()}
                alt="preview"
              />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
};
