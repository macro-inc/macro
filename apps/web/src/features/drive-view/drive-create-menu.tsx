import { ViewSidebar } from '@app/components/view-shell';
import {
  CREATABLE_BLOCKS,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import PlusIcon from '@phosphor/plus.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useDriveView } from './context/drive-context';

/** Launcher integration for the current Drive folder. */
export function DriveCreateMenu() {
  const { state, actions } = useDriveView();

  const isEnabled = useCreatableEnabled();

  const options = () =>
    CREATABLE_BLOCKS.filter(
      (block) =>
        ['md', 'snippet', 'spreadsheet', 'canvas', 'code', 'project'].includes(
          block.blockName
        ) && isEnabled(block.blockName)
    );

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger as={ViewSidebar.Action} aria-label="New file or folder">
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">New</span>
        <ViewSidebar.Trailing>
          <CaretDownIcon class="size-3 shrink-0" />
        </ViewSidebar.Trailing>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
          <For each={options()}>
            {(option) => (
              <Dropdown.Item
                onSelect={() =>
                  runCreateAction(option.blockName, {
                    projectId: state.projectId(),
                    source: 'drive',
                  })
                }
              >
                <span
                  aria-hidden="true"
                  class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
                >
                  <Dynamic component={option.icon} />
                </span>
                <span>{option.label}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.Item onSelect={actions.uploadFiles}>
            <UploadIcon aria-hidden="true" class="size-4 shrink-0" />
            <span>Upload files</span>
          </Dropdown.Item>
          <Dropdown.Item onSelect={actions.uploadFolder}>
            <FolderIcon aria-hidden="true" class="size-4 shrink-0" />
            <span>Upload folder</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
