import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import { Dropdown, ToggleSwitch } from '@ui';
import { For, type JSX } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

export function ChannelSectionDropdown(props: {
  section: ChannelSectionKey;
  label: string;
  children?: JSX.Element;
}) {
  const label = () => t('channelSections.optionsFor', { name: props.label });
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        aria-label={label()}
        tooltip={label()}
        as={ViewSidebar.Control}
        variant="ghost"
        size="icon-sm"
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
      >
        <SlidersIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-44"
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[role="dialog"]')) event.preventDefault();
        }}
      >
        <ChannelSectionMenuItems section={props.section} />
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Shared personal sort and unread controls for built-in and custom sections. */
function ChannelSectionMenuItems(props: { section: ChannelSectionKey }) {
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
      <Dropdown.Sub>
        <Dropdown.SubTrigger>
          <span class="flex-1">{t('channelSections.sort')}</span>
          <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Dropdown.SubTrigger>
        <Dropdown.SubContent class="min-w-44">
          <Dropdown.Group>
            <Dropdown.RadioGroup
              value={preferences().sort}
              onChange={(value) => {
                const option = options().find(
                  (option) => option.value === value
                );
                if (option)
                  rail.setSectionPreferences(props.section, {
                    sort: option.value,
                  });
              }}
            >
              <For each={options()}>
                {(option) => (
                  <Dropdown.RadioItem closeOnSelect value={option.value}>
                    <span class="flex-1">{option.label}</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Group>
        </Dropdown.SubContent>
      </Dropdown.Sub>
      <Dropdown.Sub>
        <Dropdown.SubTrigger>
          <span class="flex-1">{t('channelSections.filter')}</span>
          <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Dropdown.SubTrigger>
        <Dropdown.SubContent class="min-w-44">
          <Dropdown.Group>
            <Dropdown.CheckboxItem
              indicator={false}
              closeOnSelect={false}
              checked={preferences().unreadOnly ?? false}
              onChange={(unreadOnly) =>
                rail.setSectionPreferences(props.section, { unreadOnly })
              }
            >
              <span class="flex-1">{t('channelSections.unreadOnly')}</span>
              <span
                inert
                aria-hidden="true"
                class="pointer-events-none flex shrink-0 items-center"
              >
                <ToggleSwitch
                  checked={preferences().unreadOnly ?? false}
                  readOnly
                />
              </span>
            </Dropdown.CheckboxItem>
          </Dropdown.Group>
        </Dropdown.SubContent>
      </Dropdown.Sub>
    </Dropdown.Group>
  );
}
