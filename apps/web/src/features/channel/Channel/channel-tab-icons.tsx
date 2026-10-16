import type { TabItem } from '@core/component/Tabs';
import ChatTextIcon from '@phosphor/chat-text.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import UsersIcon from '@phosphor/users.svg';
import type { Component, JSX } from 'solid-js';
import type { ChannelTabId } from './channel-tabs';

export const CHANNEL_TAB_ICONS: Record<
  ChannelTabId,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  messages: ChatTextIcon,
  attachments: PaperclipIcon,
  calls: PhoneIcon,
  participants: UsersIcon,
  call: PhoneCallIcon,
};

/**
 * The same tabs with their text labels swapped for icons, for a header that
 * has run out of room. A tab without an icon keeps its label.
 */
export function toIconTabItems(
  tabs: readonly TabItem[],
  iconClass = 'size-4'
): TabItem[] {
  return tabs.map((tab) => {
    const Icon = CHANNEL_TAB_ICONS[tab.value as ChannelTabId];
    if (!Icon) return { ...tab };
    return {
      value: tab.value,
      label: (
        <span
          class="flex items-center"
          title={typeof tab.label === 'string' ? tab.label : undefined}
        >
          <Icon class={iconClass} />
        </span>
      ),
    };
  });
}
