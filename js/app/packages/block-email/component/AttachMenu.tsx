import { EntityIcon } from '@core/component/EntityIcon';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { blockAcceptedFileExtensions } from '@core/constant/allBlocks';
import { fileSelector } from '@core/directive/fileSelector';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getItemBlockName } from '@core/util/getItemBlockName';
import DeviceMobileIcon from '@icon/regular/device-mobile-speaker.svg';
import LaptopIcon from '@icon/regular/laptop.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { DocumentMentionInfo } from '@lexical-core';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistoryQuery, type HistoryItem } from '@queries/history/history';
import fuzzy from 'fuzzy';
import {
  createMemo,
  createSignal,
  type JSX,
  type Setter,
  Show,
} from 'solid-js';
import { VList } from 'virtua/solid';
import { handleFileUpload } from '../util/handleFileUpload';

// NOTE: solid directives
false && fileSelector;

type AttachMenuProps = {
  open?: boolean;
  onClose?: () => void;
  trigger: JSX.Element;
  onAttach: (items: HistoryItem[]) => void;
  onAttachDocuments?: (items: DocumentMentionInfo[]) => void;
  attachedItems?: () => Item[];
  setIsPending?: Setter<boolean>;
};

function truncate(str: string, maxLength: number = 30) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

export function AttachMenu(props: AttachMenuProps) {
  const historyQuery = useHistoryQuery();
  const attachedItems = () => props.attachedItems?.() ?? [];

  const [input, setInput] = createSignal('');

  const baseHistory = createMemo(() => {
    return [...(historyQuery.data ?? [])].filter(
      (item) => !attachedItems().find((a) => a.id === item.id)
    );
  });

  const rankedHistory = createMemo(() => {
    const searchQuery = input().toLowerCase();
    if (!searchQuery) return baseHistory();
    return fuzzy
      .filter(searchQuery, baseHistory(), {
        extract: (item) => item.name,
      })
      .map((item) => item.original);
  });

  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose?.();
      }}
    >
      <DropdownMenu.Trigger>{props.trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenuContent>
          <div class="flex flex-row items-center w-full p-2 gap-2 text-sm border-b border-edge text-ink mb-1">
            <SearchIcon class="w-3 h-3" />
            <input
              value={input()}
              onInput={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.stopImmediatePropagation()}
              class="w-full"
              placeholder="Search Attachments"
            />
          </div>
          <div class="flex flex-col gap-1 max-h-[250px] w-[300px] overflow-y-auto">
            <Show
              when={rankedHistory().length > 0}
              fallback={
                <div class="p-2 w-full flex-col justify-center items-center">
                  <p class="text-sm text-ink-muted">No results</p>
                </div>
              }
            >
              <VList
                data={rankedHistory()}
                bufferSize={10 * 40}
                itemSize={40}
                style={{ height: '100%', contain: 'content' }}
              >
                {(item) => (
                  <MenuItem
                    text={truncate(item.name)}
                    icon={() => (
                      <EntityIcon
                        targetType={getItemBlockName(item, true)}
                        size="xs"
                      />
                    )}
                    closeOnSelect
                    onClick={() => {
                      props.onAttach([item]);
                    }}
                  />
                )}
              </VList>
            </Show>
          </div>
          <div class="w-full h-px bg-edge mt-[1px]" />
          <div
            class="w-full"
            use:fileSelector={{
              acceptedFileExtensions: blockAcceptedFileExtensions,
              multiple: true,
              onSelect: async (files) => {
                if (props.setIsPending) {
                  await handleFileUpload(files, props.setIsPending, (items) => {
                    // Use direct DocumentMentionInfo if callback exists
                    if (props.onAttachDocuments) {
                      props.onAttachDocuments(items);
                      return;
                    }

                    // Fallback to Item conversion for backward compatibility
                    const itemsToAttach = items.map((item) => ({
                      id: item.documentId,
                      name: item.documentName,
                      type:
                        item.blockName === 'project' ? 'project' : 'document',
                      fileType:
                        item.blockName !== 'project'
                          ? item.blockName
                          : undefined,
                    })) as Item[];

                    props.onAttach(itemsToAttach);
                  });
                }
                props.onClose?.();
              },
            }}
          >
            <MenuItem
              text={
                isTouchDevice()
                  ? 'Upload from your device'
                  : 'Upload from your computer'
              }
              icon={isTouchDevice() ? DeviceMobileIcon : LaptopIcon}
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
