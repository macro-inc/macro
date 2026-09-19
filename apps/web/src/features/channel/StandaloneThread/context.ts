import type {
  Message as EntityMessage,
  MessageListItem,
} from '@service-storage/messages';
import {
  type Accessor,
  createContext,
  type Setter,
  useContext,
} from 'solid-js';
import type { FocusRequest } from '../Thread/focus-request';

export type StandaloneThreadContextValue = {
  channelId: Accessor<string>;
  messageId: Accessor<string>;
  parent: Accessor<MessageListItem | undefined>;
  replies: Accessor<EntityMessage[]>;
  displayReplies: Accessor<EntityMessage[]>;
  hasReplies: Accessor<boolean>;
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
  isReplying: Accessor<boolean>;
  setIsReplying: Setter<boolean>;
  replyInputFocusRequest: FocusRequest;
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
