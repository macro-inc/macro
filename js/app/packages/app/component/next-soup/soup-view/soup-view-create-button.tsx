import { CREATABLE_BLOCKS, runCreateAction } from '@app/component/Launcher';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import type { BlockName } from '@core/block';
import ChevronDownIcon from '@icon/regular/caret-down.svg';
import UploadIcon from '@icon/regular/upload-simple.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { createMemo, For, Show } from 'solid-js';
import { Button } from '@ui/components/Button';
import { NewCallButton } from './NewCallButton';

// Which blocks to show as create options per view, in order
const VIEW_CREATE_BLOCKNAMES: Partial<Record<ListView, BlockName[]>> = {
  documents: ['md', 'canvas', 'code'],
  tasks: ['task'],
  agents: ['chat', 'automation'],
  mail: ['email'],
  channels: ['channel'],
  folders: ['project'],
};

type CreateOption = {
  id: BlockName | 'import-file' | 'import-folder';
  label: string;
};

const IMPORT_FILE_OPTION: CreateOption = {
  id: 'import-file',
  label: 'Import file',
};
const IMPORT_FOLDER_OPTION: CreateOption = {
  id: 'import-folder',
  label: 'Import folder',
};

/**
 * Fallback labels for blocks that shouldn't appear in the global launcher
 * (and thus aren't in CREATABLE_BLOCKS) but still need a create entry in
 * specific list views.
 */
const VIEW_ONLY_BLOCK_LABELS: Partial<Record<BlockName, string>> = {
  automation: 'Automation',
};

function getViewCreateOptions(view: ListView): CreateOption[] {
  const createNames = VIEW_CREATE_BLOCKNAMES[view] ?? [];
  const options: CreateOption[] = createNames.flatMap((name) => {
    const block = CREATABLE_BLOCKS.find((b) => b.blockName === name);
    if (block) return [{ id: block.blockName, label: block.label }];
    const viewOnlyLabel = VIEW_ONLY_BLOCK_LABELS[name];
    if (viewOnlyLabel) return [{ id: name, label: viewOnlyLabel }];
    return [];
  });
  if (view === 'documents') {
    options.push(IMPORT_FILE_OPTION);
    options.push(IMPORT_FOLDER_OPTION);
  }
  if (view === 'folders') {
    options.push(IMPORT_FOLDER_OPTION);
  }
  return options;
}

function CreateOptionIcon(props: {
  id: BlockName | 'import-file' | 'import-folder';
}) {
  return (
    <Show
      when={props.id !== 'import-file' && props.id !== 'import-folder'}
      fallback={<UploadIcon class="size-3.5" />}
    >
      <EntityIcon
        targetType={props.id as BlockName}
        size="xs"
        class="mobile:size-6"
      />
    </Show>
  );
}

export const SoupViewCreateButton = () => {
  const panel = useSplitPanelOrThrow();
  const handleFileUpload = useHandleFileUpload();

  const currentView = createMemo(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return undefined;
    return isListViewID(content.id) ? content.id : undefined;
  });

  const options = createMemo<CreateOption[]>(() => {
    const view = currentView();
    if (!view) return [];
    return getViewCreateOptions(view);
  });

  const handleSelect = (option: CreateOption) => {
    if (option.id === 'import-file') {
      openFilePicker({ multiple: true }, async (files) => {
        await handleFileUpload(files, false);
      });
      return;
    }
    if (option.id === 'import-folder') {
      openFolderPicker({}, async (files) => {
        await handleFolderSelect(files, async (fileEntries) => {
          await handleFileUpload(fileEntries, false);
        });
      });
      return;
    }
    runCreateAction(option.id);
  };

  return (
    <>
      <Show when={currentView() === 'calls'}>
        <NewCallButton />
      </Show>
      <Show when={options().length > 0}>
        <Show
          when={options().length > 1}
          fallback={
            <Button
              variant="secondary"
              size="sm"
              class="rounded-xs whitespace-nowrap px-2 text-ink-muted hover:text-ink"
              onClick={() => handleSelect(options()[0])}
            >
              <CreateOptionIcon id={options()[0].id} />
              Create
            </Button>
          }
        >
          <DropdownMenu placement="bottom-start" gutter={4}>
            <DropdownMenu.Trigger
              as={Button}
              variant="secondary"
              size="sm"
              class="rounded-xs whitespace-nowrap px-2 text-ink-muted hover:text-ink"
            >
              <span>Create</span>
              <ChevronDownIcon class="size-3" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenuContent class="z-action-menu min-w-[160px]">
                <For each={options()}>
                  {(item) => (
                    <MenuItem
                      text={item.label}
                      icon={<CreateOptionIcon id={item.id} />}
                      onClick={() => handleSelect(item)}
                    />
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>
      </Show>
    </>
  );
};
