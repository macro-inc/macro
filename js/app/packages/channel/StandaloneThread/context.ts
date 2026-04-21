import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import {
  createContext,
  useContext,
  type Accessor,
  type Setter,
} from 'solid-js';

export type StandaloneThreadContextValue = {
  channelId: Accessor<string>;
  messageId: Accessor<string>;
  parent: Accessor<ApiChannelMessage | undefined>;
  replies: Accessor<ApiThreadReply[]>;
  displayReplies: Accessor<ApiThreadReply[]>;
  hasReplies: Accessor<boolean>;
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
  isReplying: Accessor<boolean>;
  setIsReplying: Setter<boolean>;
};

const StandaloneThreadContext = createContext<StandaloneThreadContextValue>();

export function useStandaloneThread(): StandaloneThreadContextValue {
  const ctx = useContext(StandaloneThreadContext);
  if (!ctx)
    throw new Error(
      'useStandaloneThread must be used inside StandaloneThread.Root'
    );
  return ctx;
}

export { StandaloneThreadContext };
