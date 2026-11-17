import { t } from '@app/lib/i18n';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import { Dropdown } from '@ui';
import { FolderActionItems } from './vault-sidebar';

/** The list header's "…" menu for the open folder. */
export function FolderActionsMenu(props: {
  name: string;
  onSubfolder: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="secondary"
        size="icon-md"
        // No tooltip: it opens over the menu and covers its first row.
        aria-label={t('passwords.folderActions', { name: props.name })}
      >
        <DotsThreeIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-48 max-w-[calc(100vw-2rem)]"
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        <FolderActionItems
          onSubfolder={props.onSubfolder}
          onRename={props.onRename}
          onMove={props.onMove}
          onDelete={props.onDelete}
          item={(item) => (
            <Dropdown.Item onSelect={item.onSelect}>
              <span class={item.danger ? 'text-failure-ink' : undefined}>
                {item.text}
              </span>
            </Dropdown.Item>
          )}
        />
      </Dropdown.Content>
    </Dropdown>
  );
}
