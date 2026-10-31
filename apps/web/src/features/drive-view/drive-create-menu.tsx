import { ViewSidebar } from '@app/components/view-shell';
import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import {
  CREATABLE_BLOCKS,
  type CreatableName,
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { type TranslationKey, t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import FileIcon from '@icon/system/regular/file.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { useDriveView } from './context/drive-context';
import { driveCreateDestinationLabel } from './core/location-label';

/** Each choice's description, translated where it renders. */
const creationDescriptions: Partial<Record<CreatableName, TranslationKey>> = {
  md: 'create.guideDocument',
  snippet: 'create.guideSnippet',
  spreadsheet: 'create.guideSpreadsheet',
  canvas: 'create.guideCanvas',
  code: 'create.guideCode',
  project: 'create.guideFolderProject',
  database: 'create.guideDatabase',
  form: 'create.guideForm',
};

function SidebarTrigger(props: { label: string }) {
  return (
    <Dropdown.Trigger as={ViewSidebar.Action} aria-label={props.label}>
      <ViewSidebar.Icon>
        <PlusIcon class="size-4" />
      </ViewSidebar.Icon>
      <span class="truncate">{t('create.new')}</span>
      <ViewSidebar.Trailing>
        <CaretDownIcon class="size-3 shrink-0" />
      </ViewSidebar.Trailing>
    </Dropdown.Trigger>
  );
}

function ToolbarTrigger(props: { label: string }) {
  return (
    <Dropdown.Trigger variant="secondary" size="md" aria-label={props.label}>
      <PlusIcon class="size-4" />
      <span>{t('create.new')}</span>
      <CaretDownIcon class="size-3" />
    </Dropdown.Trigger>
  );
}

/** Launcher integration for the current Drive folder. */
export function DriveCreateMenu(props: {
  /** `toolbar` is a compact button for the list header's control row. */
  presentation?: 'sidebar' | 'toolbar';
}) {
  const { state, sidebar, actions } = useDriveView();

  const isEnabled = useCreatableEnabled();

  const isToolbar = () => props.presentation === 'toolbar';

  const destination = () =>
    driveCreateDestinationLabel(state.projectId(), sidebar.folders());

  const label = () =>
    t('create.newFileOrFolderIn', { destination: destination() });

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
    runCreateAction(blockName, {
      projectId: state.projectId(),
      source: 'drive',
      destination: destination(),
      openCreated: actions.openCreated,
    });
  };

  return (
    <Dropdown placement={isToolbar() ? 'bottom-end' : 'bottom-start'}>
      <Show
        when={!isTouchDevice()}
        fallback={
          <Show
            when={isToolbar()}
            fallback={<SidebarTrigger label={label()} />}
          >
            <ToolbarTrigger label={label()} />
          </Show>
        }
      >
        <Dropdown.Trigger
          as={ViewCreateButton}
          presentation={props.presentation ?? 'sidebar'}
          menu
          aria-label={label()}
        />
      </Show>
      <Dropdown.Content class="w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto">
        <Dropdown.Group>
          <Dropdown.GroupLabel class="min-w-0 gap-1.5">
            <span class="shrink-0">{t('create.createIn')}</span>
            <FolderIcon aria-hidden="true" class="size-3.5 shrink-0" />
            <span class="min-w-0 truncate font-medium text-ink-muted">
              {destination()}
            </span>
          </Dropdown.GroupLabel>
          <For each={options()}>
            {(option) => (
              <CreateMenuItem
                icon={option.icon ?? FileIcon}
                title={option.label}
                description={t(
                  creationDescriptions[option.blockName] ??
                    'create.guideInThisFolder'
                )}
                onSelect={() => select(option.blockName)}
              />
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <CreateMenuItem
            icon={UploadIcon}
            title={t('create.uploadFiles')}
            description={t('create.guideUploadFiles')}
            onSelect={actions.uploadFiles}
          />
          <CreateMenuItem
            icon={FolderIcon}
            title={t('create.uploadFolder')}
            description={t('create.guideUploadFolder')}
            onSelect={actions.uploadFolder}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
