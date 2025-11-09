import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { OldMenu } from '@core/component/OldMenu';
import { blockAcceptedFileExtensionSet } from '@core/constant/allBlocks';
import { onKeyDownClick, onKeyUpClick } from '@core/util/click';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import FileText from '@phosphor-icons/core/regular/file-text.svg?component-solid';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { useHistory } from '@service-storage/history';
import { createEffect, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { Tools } from '../constants';
import { selectedFileSignal } from '../operation/file';
import { useSelect } from '../operation/select';
import { useToolManager } from '../signal/toolManager';

type FileItem = {
  name: string;
  id: string;
  type?: FileType;
};

function ItemOption(props: { file: FileItem; type: ItemType }) {
  const setSelectedFile = selectedFileSignal.set;
  const toolManager = useToolManager();
  const select = useSelect();

  const selectFile = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select.abort();
    setSelectedFile({
      type: props.type,
      id: props.file.id,
    });
    toolManager.setSelectedTool(Tools.File);
  };

  return (
    <div
      class="w-72 flex flex-row rounded hover:bg-hover hover-transition-bg p-2 text-sm select-none items-center"
      onmousedown={selectFile}
      onKeyDown={onKeyDownClick(selectFile)}
      onKeyUp={onKeyUpClick(selectFile)}
      ontouchstart={selectFile}
      tabIndex={0}
    >
      <EntityIcon
        targetType={props.file.type ?? (props.type as 'chat')}
        size={'sm'}
      />
      <div class="ml-2 line-clamp-1 text-ellipsis">{props.file.name}</div>
    </div>
  );
}

export function FileSelector() {
  const [userFiles, setUserFiles] = createSignal<
    { file: FileItem; type: string }[]
  >([]);
  const history = useHistory();
  const { focusCanvas } = useToolManager();

  const [fileSelectorOpen, setFileSelectorOpen] = createSignal(false);

  createEffect(async () => {
    const files: { file: FileItem; type: string }[] = [];
    history().forEach((item) => {
      if (
        item.type === 'document' &&
        item.fileType &&
        blockAcceptedFileExtensionSet.has(item.fileType)
      ) {
        const file = {
          name: item.name,
          id: item.id,
          type: item.fileType as FileType,
        };
        files.push({ file, type: 'document' });
      }
      if (item.type === 'chat') {
        const file = { name: item.name, id: item.id };
        files.push({ file, type: 'chat' });
      }
    });
    setUserFiles(files);
  });

  return (
    <DropdownMenu open={fileSelectorOpen()} onOpenChange={setFileSelectorOpen}>
      <DropdownMenu.Trigger class="dropdown-menu__trigger">
        <IconButton
          tooltip={{ label: 'File' }}
          theme="clear"
          icon={FileText}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class="dropdown-menu__content"
          onCloseAutoFocus={focusCanvas}
        >
          <OldMenu width="lg">
            <div class="w-full p-1">
              <Show
                when={userFiles().length > 0}
                fallback={
                  <div class="p-4 text-center text-sm">No files found.</div>
                }
              >
                <VList
                  data={userFiles()}
                  style={{ height: '320px', 'overflow-x': 'hidden' }}
                  overscan={10}
                >
                  {(item) => (
                    <DropdownMenu.Item>
                      <ItemOption
                        file={item.file}
                        type={item.type as ItemType}
                      />
                    </DropdownMenu.Item>
                  )}
                </VList>
              </Show>
            </div>
          </OldMenu>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
