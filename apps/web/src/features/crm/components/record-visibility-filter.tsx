import { t } from '@app/lib/i18n';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import { Button, Dropdown } from '@ui';
import { Show } from 'solid-js';

/** One explicit, exclusive view shared by CRM record lists. */
export function RecordVisibilityFilter(props: {
  archived: boolean;
  onChange: (archived: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Shows the funnel alone, naming the choice in its tooltip (a narrow header). */
  iconOnly?: boolean;
}) {
  const size = () => props.size ?? 'sm';
  const iconSize = () => (size() === 'md' ? 'icon-md' : 'icon-sm');
  const label = () =>
    props.archived ? t('viewMenus.crmArchived') : t('viewMenus.crmVisible');
  return (
    <Dropdown>
      <Dropdown.Trigger
        as={Button}
        variant="secondary"
        size={props.iconOnly ? iconSize() : size()}
        aria-label={t('viewMenus.crmVisibility')}
        tooltip={props.iconOnly ? label() : undefined}
      >
        <FunnelIcon class="size-4" />
        <Show when={!props.iconOnly}>{label()}</Show>
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
