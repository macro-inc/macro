import { CallWaveform } from '@channel/Call/CallWaveform';
import ChatTextIcon from '@icon/system/regular/chat-text.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import UsersIcon from '@icon/system/regular/users.svg';
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
  call: CallWaveform,
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
