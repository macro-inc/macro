import { CreateMenuItem } from '@app/components/view-shell/CreateMenuItem';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import {
  CREATABLE_BLOCKS,
  type CreatableName,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { type TranslationKey, t } from '@app/lib/i18n';
import FileIcon from '@icon/system/regular/file.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import { useDriveView } from './context/drive-context';
import { useDriveRedesign } from './context/drive-redesign-context';
import { driveCreateDestinationLabel } from './core/location-label';

const CREATION_DESCRIPTIONS: Partial<Record<CreatableName, TranslationKey>> = {
  md: 'create.guideDocument',
  snippet: 'create.guideSnippet',
  spreadsheet: 'create.guideSpreadsheet',
  canvas: 'create.guideCanvas',
  code: 'create.guideCode',
  database: 'create.guideDatabase',
  form: 'create.guideForm',
};

const CREATABLE_ORDER: readonly CreatableName[] = [
  'md',
  'spreadsheet',
  'canvas',
  'database',
  'form',
  'code',
  'snippet',
];

/**
 * Redesigned Drive "New" menu: instant inline folder creation, folder-with-files
 * composer, every creatable block (including Databases & Forms inside folders),
 * and local file/folder uploads.
 */
export function DriveRedesignCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
  onStartInlineFolder: () => void;
}) {
  const { state, sidebar, actions } = useDriveView();
  const { host } = useDriveRedesign();
  const isEnabled = useCreatableEnabled();

  const isToolbar = () => props.presentation === 'toolbar';
  const destination = () =>
    driveCreateDestinationLabel(state.projectId(), sidebar.folders());
  const label = () =>
    t('create.newFileOrFolderIn', { destination: destination() });

  const options = () =>
    CREATABLE_ORDER.flatMap((blockName) => {
      const found = CREATABLE_BLOCKS.find(
        (block) => block.blockName === blockName
      );
      if (!found || !isEnabled(found.blockName)) return [];
      return [found];
    });

  return (
    <Dropdown placement={isToolbar() ? 'bottom-end' : 'bottom-start'}>
      <Dropdown.Trigger
        as={ViewCreateButton}
        presentation={props.presentation ?? 'sidebar'}
        menu
        aria-label={label()}
      />
      <Dropdown.Content class="max-h-[75vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
        <Dropdown.Group>
          <Dropdown.GroupLabel class="min-w-0 gap-1.5">
            <span class="shrink-0">{t('create.createIn')}</span>
            <FolderIcon aria-hidden="true" class="size-3.5 shrink-0" />
            <span class="min-w-0 truncate font-medium text-ink-muted">
              {destination()}
            </span>
          </Dropdown.GroupLabel>
          <CreateMenuItem
            icon={FolderPlusIcon}
            title={t('drive.newFolderInline')}
            description={t('create.guideFolderProject')}
            onSelect={props.onStartInlineFolder}
          />
          <CreateMenuItem
            icon={FolderIcon}
            title={t('drive.newFolderWithFiles')}
            description={t('create.guideUploadFolder')}
            onSelect={() =>
              host.openCreateFolderWithFiles(state.projectId() ?? null)
            }
          />
        </Dropdown.Group>
        <Dropdown.Group>
          <For each={options()}>
            {(option) => (
              <CreateMenuItem
                icon={option.icon ?? FileIcon}
                title={option.label}
                description={t(
                  CREATION_DESCRIPTIONS[option.blockName] ??
                    'create.guideInThisFolder'
                )}
                onSelect={() => host.createNewItem(option.blockName)}
              />
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <CreateMenuItem
            icon={UploadIcon}
            title={t('drive.uploadFiles')}
            description={t('create.guideUploadFiles')}
            onSelect={actions.uploadFiles}
          />
          <CreateMenuItem
            icon={FolderIcon}
            title={t('drive.uploadFolder')}
            description={t('create.guideUploadFolder')}
            onSelect={actions.uploadFolder}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
