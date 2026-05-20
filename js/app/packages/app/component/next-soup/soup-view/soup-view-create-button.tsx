import { CREATABLE_BLOCKS, runCreateAction } from '@app/component/Launcher';
import { CollapsibleHeaderItem } from '@app/component/split-layout/components/CollapsibleHeaderItem';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import PlusCircleIcon from '@phosphor/plus-circle.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { Button, Dropdown, Layer } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { NewCallButton } from './NewCallButton';

// Which blocks to show as create options per view, in order
const VIEW_CREATE_BLOCKNAMES: Partial<
  Record<ListView, (BlockName | BlockAlias)[]>
> = {
  documents: ['md', 'canvas', 'code'],
  tasks: ['task'],
  agents: ['chat', 'automation'],
  mail: ['email'],
  channels: ['channel'],
  folders: ['project'],
};

type CreateOption = {
  id: BlockName | BlockAlias | 'import-file' | 'import-folder';
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
const VIEW_ONLY_BLOCK_LABELS: Partial<Record<BlockName | BlockAlias, string>> =
  {
    automation: 'Automation',
  };

const VIEW_CREATE_LABELS: Partial<Record<ListView, string>> = {
  agents: 'Agent',
  channels: 'Channel',
  documents: 'Document',
  folders: 'Folder',
  mail: 'Email',
  tasks: 'Task',
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
  id: BlockName | BlockAlias | 'import-file' | 'import-folder';
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
  const createLabel = createMemo(() => {
    const view = currentView();
    if (!view) return 'Create';
    return VIEW_CREATE_LABELS[view] ?? 'Create';
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

  const SingleOptionButton = (props: { hideLabel?: boolean }) => (
    <Button
      variant="accent-reverse"
      depth={5}
      class="rounded-full px-3 py-2 pl-1 font-bold"
      size="sm"
      onClick={() => handleSelect(options()[0])}
    >
      <PlusCircleIcon class="size-3.5" />
      <Show when={!props.hideLabel}>
        <span>{createLabel()}</span>
      </Show>
    </Button>
  );

  const MultiOptionButton = (props: { hideLabel?: boolean }) => (
    <Dropdown placement="bottom-start" gutter={4}>
      <Dropdown.Trigger
        variant="accent-reverse"
        depth={5}
        class="rounded-full px-3 pl-1 py-2 font-bold"
      >
        <PlusCircleIcon class="size-3.5" />
        <Show when={!props.hideLabel}>
          <span>{createLabel()}</span>
        </Show>
        <ChevronDownIcon class="size-2.5" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Layer depth={2}>
          <Dropdown.Content class="min-w-35">
            <For each={options()}>
              {(item) => (
                <Dropdown.Item
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                  onSelect={() => handleSelect(item)}
                >
                  <span class="size-3.5 flex items-center justify-center shrink-0 text-ink-muted">
                    <CreateOptionIcon id={item.id} />
                  </span>
                  <span class="flex-1 truncate text-ink-muted">
                    {item.label}
                  </span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Layer>
      </Dropdown.Portal>
    </Dropdown>
  );

  return (
    <>
      <Show when={currentView() === 'calls'}>
        <NewCallButton />
      </Show>
      <Show when={options().length > 0}>
        <CollapsibleHeaderItem
          id="create-button"
          priority={2}
          expanded={() => (
            <Show when={options().length > 1} fallback={<SingleOptionButton />}>
              <MultiOptionButton />
            </Show>
          )}
          collapsed={() => (
            <Show
              when={options().length > 1}
              fallback={<SingleOptionButton hideLabel />}
            >
              <MultiOptionButton hideLabel />
            </Show>
          )}
        />
      </Show>
    </>
  );
};
