import {
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from '@channel/Channel/channel-tabs';
import { isNativeIosCallKitEnabled } from './use-callkit';

export function getCallJoinTab(): ChannelTabId {
  return isNativeIosCallKitEnabled() ? DEFAULT_CHANNEL_TAB : 'call';
}

export function getCallLeaveTab(): ChannelTabId {
  return DEFAULT_CHANNEL_TAB;
}
