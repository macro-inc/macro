import { t } from '@app/lib/i18n';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import type { ChannelSectionKey } from '../../types';
import { useChannelsRail } from './ChannelsRailContext';

/** Shared personal sort and unread controls for built-in and custom sections. */
export function ChannelSectionMenuItems(props: { section: ChannelSectionKey }) {
  const rail = useChannelsRail();
  const preferences = () => rail.sectionPreferences(props.section);
  const options = () => [
    ...(props.section === 'favorites' || props.section.startsWith('label:')
      ? [{ value: 'name' as const, label: t('channelSections.alphabetical') }]
      : []),
    { value: 'viewed_at' as const, label: t('channelSections.lastViewed') },
    { value: 'updated_at' as const, label: t('channelSections.lastUpdated') },
    { value: 'created_at' as const, label: t('channelSections.dateCreated') },
  ];
  return (
    <Dropdown.Group>
      <Dropdown.GroupLabel>{t('channelSections.sortBy')}</Dropdown.GroupLabel>
      <Dropdown.RadioGroup
        value={preferences().sort}
        onChange={(value) => {
          const option = options().find((option) => option.value === value);
          if (option)
            rail.setSectionPreferences(props.section, { sort: option.value });
        }}
      >
        <For each={options()}>
          {(option) => (
            <Dropdown.RadioItem value={option.value}>
              <Dropdown.ItemIndicator />
              <span>{option.label}</span>
            </Dropdown.RadioItem>
          )}
        </For>
      </Dropdown.RadioGroup>
      <Dropdown.Separator />
      <Dropdown.CheckboxItem
        checked={preferences().unreadOnly ?? false}
        onChange={(unreadOnly) =>
          rail.setSectionPreferences(props.section, { unreadOnly })
        }
      >
        <span>{t('channelSections.unreadOnly')}</span>
      </Dropdown.CheckboxItem>
    </Dropdown.Group>
  );
}
