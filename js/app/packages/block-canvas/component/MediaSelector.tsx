import {
  canvasDraggingSignal,
  useCanvasFileDrop,
} from '@block-canvas/signal/fileDrop';
import { useRenderState } from '@block-canvas/store/RenderState';
import { vec2 } from '@block-canvas/util/vector2';
import { withAnalytics } from '@coparse/analytics';
import { EntityIcon } from '@core/component/EntityIcon';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent } from '@core/component/Menu';
import {
  blockAcceptsFileExtension,
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import {
  ENABLE_CANVAS_HEIC,
  ENABLE_CANVAS_VIDEO,
} from '@core/constant/featureFlags';
import { fileDrop } from '@core/directive/fileDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { HEIC_EXTENSIONS, HEIC_MIME_TYPES } from '@core/heic/constants';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import UploadSimple from '@phosphor-icons/core/bold/upload-simple-bold.svg?component-solid';
import Image from '@phosphor-icons/core/regular/image.svg?component-solid';
//import { copiedFile } from "@core/state/clipboard";
import { useHistory } from '@service-storage/history';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { Tools } from '../constants';
import { selectedImageSignal } from '../operation/image';
import { useSelect } from '../operation/select';
import { useToolManager } from '../signal/toolManager';

false && fileSelector;
false && fileDrop;

type MediaType = 'image' | 'video';

type MediaItem = {
  fileName: string;
  fileType: MediaType;
  id: string;
};

function ItemOption(props: { media: MediaItem }) {
  const setSelectedImage = selectedImageSignal.set;
  const toolManager = useToolManager();
  const select = useSelect();
  const { track, TrackingEvents } = withAnalytics();

  const selectItem = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select.abort();
    setSelectedImage({
      type: props.media.fileType,
      id: props.media.id,
    });
    track(TrackingEvents.BLOCKCANVAS.IMAGES.DSSIMAGE, {
      method: 'dropdown click',
    });
    toolManager.setSelectedTool(Tools.Image);
  };

  return (
    <div
      class="w-72 flex flex-row rounded hover:bg-hover hover-transition-bg p-2 text-sm select-none items-center"
      onmousedown={selectItem}
      ontouchstart={selectItem}
    >
      <EntityIcon targetType={props.media.fileType} size="sm" />
      <div class="line-clamp-1 overflow-hidden text-ellipsis ml-2">
        {props.media.fileName}
      </div>
    </div>
  );
}

export function MediaSelector() {
  const mediaTypes: MediaType[] = ENABLE_CANVAS_VIDEO
    ? ['image', 'video']
    : ['image'];
  const history = useHistory();
  //const copiedFileID = copiedFile();
  const { track, TrackingEvents } = withAnalytics();
  const select = useSelect();
  const { handleFileDrop } = useCanvasFileDrop();
  const [isDragging, setIsDragging] = canvasDraggingSignal;
  const { viewBox } = useRenderState();
  const centerVec = createMemo(() => {
    return vec2(viewBox().x + viewBox().w / 2, viewBox().y + viewBox().h / 2);
  });
  const { focusCanvas } = useToolManager();

  const [imageSelectorOpen, setImageSelectorOpen] = createSignal(false);

  const imageExtensions = blockNameToFileExtensions.image;
  const imageMimeTypes = blockNameToMimeTypes.image;
  const videoExtensions = blockNameToFileExtensions.video;
  const videoMimeTypes = blockNameToMimeTypes.video;

  const canvasImageExtensions = ENABLE_CANVAS_HEIC
    ? [...imageExtensions, ...HEIC_EXTENSIONS]
    : imageExtensions;
  const canvasImageMimeTypes = ENABLE_CANVAS_HEIC
    ? [...imageMimeTypes, ...HEIC_MIME_TYPES]
    : imageMimeTypes;

  const acceptedMimeTypes = ENABLE_CANVAS_VIDEO
    ? [...canvasImageMimeTypes, ...videoMimeTypes]
    : canvasImageMimeTypes;
  const acceptedFileExtensions = ENABLE_CANVAS_VIDEO
    ? [...canvasImageExtensions, ...videoExtensions]
    : canvasImageExtensions;

  const userMediaFiles = createMemo(() => {
    const mediaFiles: MediaItem[] = [];
    for (const item of history()) {
      for (const mediaType of mediaTypes) {
        if (
          item.type === 'document' &&
          item.fileType &&
          blockAcceptsFileExtension(mediaType, item.fileType)
        ) {
          mediaFiles.push({
            fileName: item.name,
            fileType: mediaType,
            id: item.id,
          });
        }
      }
    }

    return mediaFiles;
  });

  return (
    <DropdownMenu
      open={imageSelectorOpen()}
      onOpenChange={setImageSelectorOpen}
    >
      <DropdownMenu.Trigger class="dropdown-menu__trigger">
        <IconButton
          tooltip={{ label: 'Media' }}
          theme="clear"
          icon={Image}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent
          class="dropdown-menu__content"
          onCloseAutoFocus={focusCanvas}
        >
          <div
            use:fileDrop={{
              acceptedMimeTypes: acceptedMimeTypes,
              acceptedFileExtensions: acceptedFileExtensions,
              onDragStart: () => setIsDragging(true),
              onDragEnd: () => setIsDragging(false),
              onDrop: (files) => {
                track(TrackingEvents.BLOCKCANVAS.IMAGES.STATICIMAGE, {
                  method: 'drag to dropdown',
                });
                handleFileDrop(files, centerVec());
                setImageSelectorOpen(false);
              },
            }}
            class="flex flex-col gap-1"
          >
            <Show when={!isNativeMobilePlatform()}>
              <Show when={isDragging()}>
                <FileDropOverlay valid={true}>
                  <div class="font-mono">
                    Drop any file here to add it to your canvas
                  </div>
                </FileDropOverlay>
              </Show>
              <DropdownMenu.Item closeOnSelect={false}>
                <div
                  class="w-72 flex flex-row select-none items-center gap-1 "
                  onmousedown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    select.abort();
                  }}
                  ontouchstart={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    select.abort();
                  }}
                >
                  <div
                    class="w-full hidden sm:flex p-2 mb-1 bg-edge/15 hover:bg-accent/15 hover-transition-bg transition-colors items-center justify-center gap-2"
                    use:fileSelector={{
                      acceptedFileExtensions: acceptedFileExtensions,
                      acceptedMimeTypes: acceptedMimeTypes,
                      onSelect: (files: File[]) => {
                        track(TrackingEvents.BLOCKCANVAS.IMAGES.STATICIMAGE, {
                          method: 'click dropdown button',
                        });
                        handleFileDrop(files, centerVec());
                        setImageSelectorOpen(false);
                      },
                    }}
                  >
                    <UploadSimple class="w-3.5 h-3.5 shrink-0 text-accent-ink" />
                    <span class="text-sm font-medium text-accent-ink">
                      Upload File
                    </span>
                  </div>
                </div>
              </DropdownMenu.Item>
            </Show>
            <div class="w-full">
              <Show
                when={userMediaFiles().length > 0}
                fallback={
                  <div class="p-4 text-sm text-center">No media found.</div>
                }
              >
                <VList
                  data={userMediaFiles()}
                  style={{ height: '256px' }}
                  overscan={10}
                >
                  {(media) => (
                    <DropdownMenu.Item closeOnSelect={true} class="w-full">
                      <ItemOption media={media} />
                    </DropdownMenu.Item>
                  )}
                </VList>
              </Show>
              {/* <Show when={copiedFile()}>
                      <DropdownMenu.Item>
                        <ItemOption image={{fileName:"Insert from clipboard", id:copiedFile()!}} />
                      </DropdownMenu.Item>
                    </Show> */}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
