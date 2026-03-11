import { SERVER_HOSTS } from '@core/constant/servers';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ExpandIcon from '@icon/regular/arrows-out-simple.svg';
import ClipboardIcon from '@icon/regular/clipboard.svg';
import ThreeDotsIcon from '@icon/regular/dots-three-vertical.svg';
import DownloadIcon from '@icon/regular/download-simple.svg';
import TrashIcon from '@icon/regular/trash.svg';
import { Dialog } from '@kobalte/core/dialog';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { type Component, createSignal, For, Show } from 'solid-js';
import { copyImageToClipboard, downloadImage } from '../util/imageActions';
import { platformFetch } from '../util/platformFetch';
import { DeprecatedIconButton } from './DeprecatedIconButton';
import { Lightbox } from './Lightbox';
import { DropdownMenuContent, MenuItem, MenuSeparator } from './Menu';

type ImageData = {
  id: string;
  width?: string | number | undefined;
  height?: string | number | undefined;
};

export type ImageGalleryPreviewProps = {
  images: ImageData[];
  initialIndex?: number;
  variant: 'small' | 'dynamic';
  square?: boolean;
  wrapperClass?: string;
  attachmentIds: string[];
  onDelete?: (attachmentId: string) => void;
  isContext?: boolean;
};

const THEMES = {
  small:
    'size-23 object-cover rounded-2xl border border-edge hover:opacity-80 select-none',
  dynamic:
    'min-w-[100px] max-h-[200px] object-contain w-full rounded-2xl select-none border border-edge hover:border-accent hover-transition-border',
};

export const ImageGalleryPreview: Component<ImageGalleryPreviewProps> = (
  props
) => {
  const [currentIndex, setCurrentIndex] = createSignal(props.initialIndex ?? 0);
  const [clickedIndex, setClickedIndex] = createSignal(0);

  const getImageUrl = (id: string) =>
    `${SERVER_HOSTS['static-file']}/file/${id}`;

  const currentImageUrl = () => {
    const id = props.images[currentIndex()]?.id;
    return id ? getImageUrl(id) : undefined;
  };

  const hasPrevious = () => currentIndex() > 0;
  const hasNext = () => currentIndex() < props.images.length - 1;

  const navigatePrevious = () => {
    if (hasPrevious()) setCurrentIndex((i) => i - 1);
  };
  const navigateNext = () => {
    if (hasNext()) setCurrentIndex((i) => i + 1);
  };

  // Thumbnail menu actions (operate on a specific image by ID)
  const copyToClipboardById = (id: string) => {
    const url = getImageUrl(id);
    return copyImageToClipboard(
      () => platformFetch(url).then((r) => r.blob()),
      url
    );
  };

  const downloadImageById = (id: string) =>
    downloadImage(
      () => platformFetch(getImageUrl(id)).then((r) => r.blob()),
      id
    );

  return (
    <Dialog
      modal={true}
      onOpenChange={(isOpen) => {
        if (isOpen) setCurrentIndex(clickedIndex());
        else setClickedIndex(0);
      }}
    >
      <div class={props.wrapperClass ?? 'flex flex-row flex-wrap gap-2'}>
        <For each={props.images}>
          {(image, index) => (
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
                      <DeprecatedIconButton icon={ExpandIcon} theme="clear" />
                    </Dialog.Trigger>
                    <DropdownMenu>
                      <DropdownMenu.Trigger disabled={props.isContext}>
                        <DeprecatedIconButton
                          icon={ThreeDotsIcon}
                          theme="clear"
                        />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <div class="fixed inset-0 z-modal-overlay bg-transparent" />
                        <DropdownMenuContent class="z-modal">
                          <MenuItem
                            text="Copy image"
                            icon={ClipboardIcon}
                            onClick={() => copyToClipboardById(image.id)}
                          />
                          <MenuItem
                            text="Download image"
                            icon={DownloadIcon}
                            onClick={() => downloadImageById(image.id)}
                          />
                          <Show when={props.onDelete}>
                            <MenuSeparator />
                            <MenuItem
                              text="Delete image"
                              icon={TrashIcon}
                              onClick={() =>
                                props.onDelete?.(props.attachmentIds[index()])
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
                    src={getImageUrl(image.id)}
                    alt="preview"
                    style={{
                      '-webkit-touch-callout': 'none',
                      '-webkit-user-select': 'none',
                      '-khtml-user-select': 'none',
                      '-moz-user-select': 'none',
                      '-ms-user-select': 'none',
                      'user-select': 'none',
                    }}
                    draggable={!isTouchDevice()}
                  />
                </Dialog.Trigger>
              </div>
            </div>
          )}
        </For>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
        <Lightbox
          src={currentImageUrl}
          imageId={() => props.images[currentIndex()]?.id ?? ''}
          onPrevious={hasPrevious() ? navigatePrevious : undefined}
          onNext={hasNext() ? navigateNext : undefined}
          indexLabel={
            props.images.length > 1
              ? () => `${currentIndex() + 1}/${props.images.length}`
              : undefined
          }
        />
      </Dialog.Portal>
    </Dialog>
  );
};
