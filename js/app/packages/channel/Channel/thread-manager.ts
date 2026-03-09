import { createStore } from 'solid-js/store';
import type { ThreadState } from '../Thread';
import { createSignal } from 'solid-js';
import type { InputSnapshot } from '@channel/Input';

type ThreadStore = Record<string, ThreadState>;
export function createThreadManager() {
  const [threadStore, setThreadStore] = createStore<ThreadStore>({});

  function initThreadState(threadId: string): ThreadState {
    const [isExpanded, setIsExpanded] = createSignal<boolean>(false);
    const [isReplying, setIsReplying] = createSignal<boolean>(false);
    const [replyInputState, setReplyInputState] = createSignal<
      InputSnapshot | undefined
    >();

    const state: ThreadState = {
      isExpanded,
      setIsExpanded,
      isReplying,
      setIsReplying,
      replyInputState,
      setReplyInputState,
    };

    setThreadStore(threadId, state);

    return state;
  }

  function getOrCreateThreadState(threadId: string): ThreadState {
    const threadState = threadStore[threadId];

    if (threadState) return threadState;

    return initThreadState(threadId);
  }

  return {
    getOrCreateThreadState,
  };
}
