import { ViewSidebar } from '@app/components/view-shell';
import {
  CREATABLE_BLOCKS,
  type CreatableName,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { useSplitLayout } from '@components/app/split-layout/layout';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FolderIcon from '@phosphor/folder.svg';
import PlusIcon from '@phosphor/plus.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useDriveView } from './context/drive-context';
import { driveCreateDestinationLabel } from './core/location-label';

/** Launcher integration for the current Drive folder. */
export function DriveCreateMenu() {
  const { state, sidebar, actions } = useDriveView();
  const { popoverSplit } = useSplitLayout();

  const isEnabled = useCreatableEnabled();

  const destination = () =>
    driveCreateDestinationLabel(state.projectId(), sidebar.folders());

  const options = () =>
    CREATABLE_BLOCKS.filter(
      (block) =>
        [
          'md',
          'snippet',
          'spreadsheet',
          'canvas',
          'code',
          'project',
          'database',
          'form',
        ].includes(block.blockName) &&
        isEnabled(block.blockName) &&
        // Databases and forms have no folder membership.
        ((block.blockName !== 'database' && block.blockName !== 'form') ||
          !state.projectId())
    );

  const select = (blockName: CreatableName) => {
    if (blockName === 'project') {
      popoverSplit({
        type: 'component',
        id: 'folder-compose',
        params: {
          parentId: state.projectId(),
          parentLabel: destination(),
          onSubmit: (submission: { folderId: string; name: string }) => {
            state.selectFolder(submission.folderId);
          },
        },
      });
      return;
    }

    runCreateAction(blockName, {
      projectId: state.projectId(),
      source: 'drive',
    });
  };

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        as={ViewSidebar.Action}
        aria-label={`New file or folder in ${destination()}`}
      >
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">New</span>
        <ViewSidebar.Trailing>
          <CaretDownIcon class="size-3 shrink-0" />
        </ViewSidebar.Trailing>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48 max-w-72">
        <Dropdown.Group>
          <Dropdown.GroupLabel class="min-w-0 gap-1.5">
            <span class="shrink-0">Create in</span>
            <FolderIcon aria-hidden="true" class="size-3.5 shrink-0" />
            <span class="min-w-0 truncate font-medium text-ink-muted">
              {destination()}
            </span>
          </Dropdown.GroupLabel>
          <For each={options()}>
            {(option) => (
              <Dropdown.Item onSelect={() => select(option.blockName)}>
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
