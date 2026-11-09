import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MENU_ITEM_CLASS,
  MenuGroup,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Dropdown, SingleSelectCheck, ToggleSwitch } from '@ui';
import { For, type JSX } from 'solid-js';
import type {
  ChannelSectionKey,
  ChannelSectionPreferences,
} from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';
import { SectionMuteMenu } from './ChannelMuteMenu';

export function ChannelSectionDropdown(props: {
  section: ChannelSectionKey;
  label: string;
  children?: JSX.Element;
  before?: JSX.Element;
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
      <DropdownMenu.Portal>
        {/* The shared menu content honors canceled focus restoration; DropdownMenu.Content always refocuses its trigger. */}
        <ContextMenuContent
          class="min-w-44"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]')) {
              event.preventDefault();
            }
          }}
        >
          {props.before}
          <ChannelSectionMenuItems section={props.section} />
          {props.children}
        </ContextMenuContent>
      </DropdownMenu.Portal>
    </Dropdown>
  );
}

/** Share the standard context-menu surface and rows with the click menu. */
export function ChannelSectionContextMenu(props: {
  section: ChannelSectionKey;
  children: JSX.Element;
  actions?: JSX.Element;
  before?: JSX.Element;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger as="div" class="min-w-0">
        {props.children}
      </ContextMenuTrigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="min-w-44"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]')) {
              event.preventDefault();
            }
          }}
        >
          {props.before}
          <ChannelSectionMenuItems section={props.section} />
          {props.actions}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

/** Shared personal sort and unread controls for built-in and custom sections. */
export function ChannelSectionMenuItems(props: { section: ChannelSectionKey }) {
  const rail = useChannelsRail();
  const preferences = () => rail.sectionPreferences(props.section);
  const options = () => {
    const items: {
      value: NonNullable<ChannelSectionPreferences['sort']>;
      label: string;
    }[] = [];

    if (props.section === 'favorites') {
      items.push({ value: 'manual', label: t('channelSections.customOrder') });
    }

    if (props.section === 'favorites' || props.section.startsWith('label:')) {
      items.push({ value: 'name', label: t('channelSections.alphabetical') });
    }

    items.push(
      { value: 'viewed_at', label: t('channelSections.lastViewed') },
      { value: 'updated_at', label: t('channelSections.lastUpdated') },
      { value: 'created_at', label: t('channelSections.dateCreated') }
    );

    return items;
  };

  return (
    <>
      <MenuGroup>
        <ContextMenu.Sub>
          <SubTrigger text={t('channelSections.sort')} />
          <ContextMenuContent submenu class="min-w-44">
            <MenuGroup>
              <ContextMenu.RadioGroup
                value={preferences().sort}
                onChange={(value) => {
                  const option = options().find(
                    (option) => option.value === value
                  );

                  if (option) {
                    rail.setSectionPreferences(props.section, {
                      sort: option.value,
                    });
                  }
                }}
              >
                <For each={options()}>
                  {(option) => (
                    <ContextMenu.RadioItem
                      class={MENU_ITEM_CLASS}
                      value={option.value}
                      closeOnSelect
                    >
                      <span class="flex-1">{option.label}</span>
                      <SingleSelectCheck
                        active={preferences().sort === option.value}
                      />
                    </ContextMenu.RadioItem>
                  )}
                </For>
              </ContextMenu.RadioGroup>
            </MenuGroup>
          </ContextMenuContent>
        </ContextMenu.Sub>
        <ContextMenu.Sub>
          <SubTrigger text={t('channelSections.display')} />
          <ContextMenuContent submenu class="min-w-44">
            <ContextMenu.CheckboxItem
              class={MENU_ITEM_CLASS}
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
            </ContextMenu.CheckboxItem>
            <ContextMenu.CheckboxItem
              class={MENU_ITEM_CLASS}
              closeOnSelect={false}
              checked={preferences().unreadWhenCollapsed ?? true}
              onChange={(unreadWhenCollapsed) =>
                rail.setSectionPreferences(props.section, {
                  unreadWhenCollapsed,
                })
              }
            >
              <span class="flex-1">
                {t('channelSections.unreadWhenCollapsed')}
              </span>
              <span
                inert
                aria-hidden="true"
                class="pointer-events-none flex shrink-0 items-center"
              >
                <ToggleSwitch
                  checked={preferences().unreadWhenCollapsed ?? true}
                  readOnly
                />
              </span>
            </ContextMenu.CheckboxItem>
          </ContextMenuContent>
        </ContextMenu.Sub>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <SectionMuteMenu section={props.section} />
      </MenuGroup>
    </>
  );
}
