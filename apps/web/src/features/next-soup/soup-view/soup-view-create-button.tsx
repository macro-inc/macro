import { isListViewID, type ListView } from '@app/constants/list-views';
import {
  CREATABLE_BLOCKS,
  type CreatableName,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/companies/CreateCompanyModal';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockName } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import BuildingsIcon from '@phosphor/buildings.svg';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import PlusCircleIcon from '@phosphor/plus-circle.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { Button, cn, Dropdown } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { NewCallButton } from './NewCallButton';

// Which blocks to show as create options per view, in order
const VIEW_CREATE_BLOCKNAMES: Partial<Record<ListView, CreatableName[]>> = {
  documents: ['md', 'snippet', 'canvas', 'code', 'project'],
  tasks: ['task'],
  agents: ['agent', 'chat', 'automation', 'skill'],
  mail: ['email'],
  channels: ['channel'],
  folders: ['project'],
  reminders: ['reminder'],
};

type CreateOption = {
  id: CreatableName | 'import-file' | 'import-folder' | 'create-company';
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
// Companies aren't blocks, so the Customers view gets a bespoke option
// that opens the create-company modal instead of a create action.
const CREATE_COMPANY_OPTION: CreateOption = {
  id: 'create-company',
  label: 'Company',
};

/**
 * Fallback labels for blocks that shouldn't appear in the global launcher
 * (and thus aren't in CREATABLE_BLOCKS) but still need a create entry in
 * specific list views.
 */
const VIEW_ONLY_BLOCK_LABELS: Partial<Record<CreatableName, string>> = {
  automation: 'Automation',
};

const VIEW_CREATE_LABELS: Partial<Record<ListView, string>> = {
  agents: 'Agent',
  channels: 'Channel',
  companies: 'Company',
  documents: 'New',
  folders: 'Folder',
  mail: 'Email',
  reminders: 'Reminder',
  tasks: 'Task',
};

function getViewCreateOptions(
  view: ListView,
  isCreatableEnabled: (name: CreatableName) => boolean
): CreateOption[] {
  const createNames = VIEW_CREATE_BLOCKNAMES[view] ?? [];
  const options: CreateOption[] = createNames.flatMap((name) => {
    const block = CREATABLE_BLOCKS.find((b) => b.blockName === name);
    if (block) {
      // A flagged-off entry is not offered here either, the same as in the
      // create menus — `runCreateAction` would decline it anyway. Asked
      // reactively, so an option appears once its flag resolves.
      if (!isCreatableEnabled(block.blockName)) return [];
      return [{ id: block.blockName, label: block.label }];
    }
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
  if (view === 'companies') {
    options.push(CREATE_COMPANY_OPTION);
  }
  return options;
}

function CreateOptionIcon(props: { id: CreateOption['id'] }) {
  return (
    <Show
      when={props.id !== 'import-file' && props.id !== 'import-folder'}
      fallback={<UploadIcon class="size-3.5" />}
    >
      <Show
        when={props.id !== 'create-company'}
        fallback={<BuildingsIcon class="size-3.5" />}
      >
        <EntityIcon
          targetType={props.id as BlockName}
          size="xs"
          class="touch:size-6"
        />
      </Show>
    </Show>
  );
}

export const SoupViewCreateButton = () => {
  const panel = useSplitPanelOrThrow();
  const handleFileUpload = useHandleFileUpload();
  const isCreatableEnabled = useCreatableEnabled();

  const currentView = createMemo(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return undefined;
    return isListViewID(content.id) ? content.id : undefined;
  });

  const options = createMemo<CreateOption[]>(() => {
    const view = currentView();
    if (!view) return [];
    return getViewCreateOptions(view, isCreatableEnabled);
  });
  const createLabel = createMemo(() => {
    const view = currentView();
    if (!view) return 'Create';
    return VIEW_CREATE_LABELS[view] ?? 'Create';
  });

  const handleSelect = (option: CreateOption) => {
    if (currentView() === 'channels' && option.id === 'channel') {
      openNewChannelModal();
      return;
    }
    if (option.id === 'create-company') {
      openCreateCompanyModal();
      return;
    }
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
      variant="accent"
      class={cn(
        'border-0 rounded-full px-3 py-2 pl-1 font-semibold',
        props.hideLabel && 'pr-1'
      )}
      size="sm"
      onClick={() => handleSelect(options()[0])}
    >
      <PlusCircleIcon class="size-3.5 text-accent" />
      <Show when={!props.hideLabel}>
        <span>{createLabel()}</span>
      </Show>
    </Button>
  );

  const MultiOptionButton = (props: { hideLabel?: boolean }) => (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="accent"
        class={cn(
          'border-0 rounded-full px-3 py-2 pl-1 font-semibold',
          props.hideLabel && 'pr-1'
        )}
      >
        <PlusCircleIcon class="size-3.5" />
        <Show when={!props.hideLabel}>
          <span>{createLabel()}</span>
        </Show>
        <ChevronDownIcon class="size-2.5" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={options()}>
            {(item) => (
              <Dropdown.Item onSelect={() => handleSelect(item)}>
                <span class="size-3.5 flex items-center justify-center shrink-0 text-ink-muted">
                  <CreateOptionIcon id={item.id} />
                </span>
                <span class="flex-1 truncate text-ink-muted">{item.label}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );

  return (
    <>
      <Show when={currentView() === 'calls'}>
        <NewCallButton />
      </Show>
      <Show when={options().length > 0}>
        <CollapsibleHeaderItem id="create-button" priority={2}>
          {(isCollapsed) => (
            <Show
              when={options().length > 1}
              fallback={<SingleOptionButton hideLabel={isCollapsed()} />}
            >
              <MultiOptionButton hideLabel={isCollapsed()} />
            </Show>
          )}
        </CollapsibleHeaderItem>
      </Show>
    </>
  );
};
