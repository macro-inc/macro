import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { INSERT_MEDIA_COMMAND } from '@core/component/LexicalMarkdown/plugins';
import { DropdownMenuContent } from '@core/component/Menu';
import {
  blockAcceptsFileExtension,
  blockNameToFileExtensions,
  blockNameToMimeTypes,
} from '@core/constant/allBlocks';
import { fileDrop } from '@core/directive/fileDrop';
import { fileSelector } from '@core/directive/fileSelector';
import ImageIcon from '@icon/regular/image.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import UploadSimple from '@phosphor-icons/core/bold/upload-simple-bold.svg?component-solid';
import { useHistory } from '@service-storage/history';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { mdStore } from '../signal/markdownBlockData';

false && fileSelector;
false && fileDrop;

type MediaType = 'image' | 'video';

type MediaItem = {
  fileName: string;
  id: string;
  fileType: MediaType;
};

function ItemOption(props: { media: MediaItem; editor?: LexicalEditor }) {
  return (
    <div
      class="w-full flex flex-row rounded hover:bg-hover hover-transition-bg p-2 mx-1 text-sm select-none items-center"
      onmousedown={(e) => {
        e.stopPropagation();
        e.preventDefault();

        props.editor?.dispatchCommand(INSERT_MEDIA_COMMAND, {
          type: 'dss',
          id: props.media.id,
          mediaType: props.media.fileType,
        });
      }}
    >
      <EntityIcon targetType={props.media.fileType} size="sm" />
      <div class="rounded-md ml-2 text-xs text-ellipsis overflow-hidden">
        {props.media.fileName}
      </div>
    </div>
  );
}

type MediaSelectorProps = {
  buttonIsDisabled?: Accessor<boolean>;
  mediaTypes?: MediaType[];
};

export function MediaSelector(props: MediaSelectorProps) {
  const { mediaTypes = ['image', 'video'] } = props;
  const mdData = mdStore.get;
  const editor = () => mdData.editor;

  const history = useHistory();
  const [menuOpen, setMenuOpen] = createSignal(false);

  const userMediaFiles = createMemo(() => {
    let mediaFiles: MediaItem[] = [];
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

  const acceptedFileExtensions = createMemo(() => {
    return mediaTypes.flatMap((type) => blockNameToFileExtensions[type]);
  });

  const acceptedMimeTypes = createMemo(() => {
    return mediaTypes.flatMap((type) => blockNameToMimeTypes[type]);
  });

  const lookUpMediaFileType = (file: File): 'image' | 'video' | null => {
    const type = file.type;
    if (type.startsWith('image/')) {
      return 'image';
    } else if (type.startsWith('video/')) {
      return 'video';
    }
    return null;
  };

  const uploadStaticMediaFiles = async (files: File[]) => {
    for (const file of files) {
      const mediaType = lookUpMediaFileType(file);
      if (mediaType === null) continue;
      editor()?.dispatchCommand(INSERT_MEDIA_COMMAND, {
        type: 'local',
        url: URL.createObjectURL(file),
        file,
        mediaType: mediaType,
      });
    }
  };
  console.log('acceptedFileExtensions', acceptedFileExtensions());
  console.log('acceptedMimeTypes', acceptedMimeTypes());

  return (
    // TODO bring up to menu best practices, ie. fully focusable menu items, etc.
    <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
      <DropdownMenu.Trigger class="dropdown-menu__trigger">
        <IconButton
          tooltip={{ label: 'Insert Media File' }}
          theme="clear"
          icon={ImageIcon}
          showChevron
          disabled={props?.buttonIsDisabled?.() ?? false}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <Show when={!props?.buttonIsDisabled?.()}>
        <DropdownMenu.Portal>
          <DropdownMenuContent
            onCloseAutoFocus={() => {
              editor()?.focus();
            }}
          >
            <div class="w-72 text-ink bg-menu">
              <div
                class="w-72 flex rounded select-none items-center"
                onmousedown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <div
                  class="w-full mt-0 p-2 m-1 bg-menu text-ink flex justify-center items-center gap-2 rounded hover:bg-hover hover-transition-bg hover:text-accent-ink @container"
                  use:fileSelector={{
                    acceptedFileExtensions: acceptedFileExtensions(),
                    acceptedMimeTypes: acceptedMimeTypes(),
                    onSelect: (files: File[]) => {
                      uploadStaticMediaFiles(files);
                      setMenuOpen(false);
                    },
                  }}
                >
                  <UploadSimple class="w-3.5 h-3.5 shrink-0" />
                  <span class="text-sm font-medium">Upload file</span>
                </div>
              </div>
              <div class="w-full max-h-80 overflow-y-auto overflow-x-hidden">
                <For
                  each={userMediaFiles()}
                  fallback={
                    <div class="m-2">You haven't added any media yet!</div>
                  }
                >
                  {(media) => <ItemOption media={media} editor={editor()} />}
                </For>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </Show>
    </DropdownMenu>
  );
}
