import { t } from '@app/lib/i18n';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import { Button, Dropdown } from '@ui';

/** One explicit, exclusive view shared by CRM record lists. */
export function RecordVisibilityFilter(props: {
  archived: boolean;
  onChange: (archived: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        as={Button}
        variant="secondary"
        size={props.size ?? 'sm'}
        aria-label={t('viewMenus.crmVisibility')}
      >
        <FunnelIcon class="size-4" />
        {props.archived
          ? t('viewMenus.crmArchived')
          : t('viewMenus.crmVisible')}
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-44 max-w-[calc(100vw-2rem)]">
        <Dropdown.RadioGroup
          value={props.archived ? 'archived' : 'visible'}
          onChange={(value) => props.onChange(value === 'archived')}
        >
          <Dropdown.RadioItem value="visible">
            {t('viewMenus.crmVisible')}
          </Dropdown.RadioItem>
          <Dropdown.RadioItem value="archived" disabled={props.disabled}>
            {t('viewMenus.crmArchived')}
          </Dropdown.RadioItem>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
