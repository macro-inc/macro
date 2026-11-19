import { t } from '@app/lib/i18n';
import SlidersHorizontalIcon from '@icon/system/regular/sliders-horizontal.svg';
import { Dropdown } from '@ui';

export type InboxDisplayMenuProps = {
  condensed: boolean;
  onCondensedChange: (condensed: boolean) => void;
  /** Open the settings that decide which notifications are delivered. */
  onOpenSettings: () => void;
};

/**
 * The list's display options, in place of the settings button: one-line
 * Condensed rows, and the way to the notification settings.
 */
export function InboxDisplayMenu(props: InboxDisplayMenuProps) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-xs"
        aria-label={t('notificationsInbox.displayOptions')}
        tooltip={t('notificationsInbox.displayOptions')}
      >
        <SlidersHorizontalIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48 max-w-72">
        <Dropdown.Group>
          <Dropdown.CheckboxItem
            checked={props.condensed}
            closeOnSelect={false}
            onChange={props.onCondensedChange}
          >
            <span class="min-w-0 flex-1 truncate">
              {t('notificationsInbox.condensed')}
            </span>
          </Dropdown.CheckboxItem>
        </Dropdown.Group>
        <Dropdown.Separator class="my-1 border-t border-edge-divider" />
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => props.onOpenSettings()}>
            <span class="min-w-0 truncate">
              {t('notificationsInbox.settingsItem')}
            </span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
