import type { ApiChannelMessage } from '@service-comms/client';
import type { Accessor, Setter } from 'solid-js';

export type ThreadState = {
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
};

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  channelId: Accessor<string>;
} & ThreadState;
