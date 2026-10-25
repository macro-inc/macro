import ChatTextIcon from '@phosphor/chat-text.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import UsersIcon from '@phosphor/users.svg';
import type { TabOption } from '@ui';
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

/** The same tabs with icons, for a header that renders them `iconOnly`. */
export function withChannelTabIcons(
  options: readonly TabOption<ChannelTabId>[]
): TabOption<ChannelTabId>[] {
  return options.map((option) => ({
    ...option,
    icon: CHANNEL_TAB_ICONS[option.value],
  }));
}
