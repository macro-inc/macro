import {
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from '@channel/Channel/channel-tabs';
import { isNativeCallEnabled } from './use-callkit';

export function getCallJoinTab(): ChannelTabId {
  return isNativeCallEnabled() ? DEFAULT_CHANNEL_TAB : 'call';
}

export function getCallLeaveTab(): ChannelTabId {
  return DEFAULT_CHANNEL_TAB;
}
