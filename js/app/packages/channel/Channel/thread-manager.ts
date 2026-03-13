import { createStore } from 'solid-js/store';
import type { ThreadState } from '../Thread';
import { batch, createSignal, type Setter } from 'solid-js';
import type { InputSnapshot } from '@channel/Input';

type ThreadStore = Record<string, ThreadState>;
export function createThreadManager() {
  const [threadStore, setThreadStore] = createStore<ThreadStore>({});

  function initThreadState(threadId: string): ThreadState {
    const [isExpanded, setIsExpanded] = createSignal<boolean>(false);
    const [isReplying, setIsReplyingRaw] = createSignal<boolean>(false);
    const [replyInputState, setReplyInputState] = createSignal<
      InputSnapshot | undefined
    >();

    /** If you set replying from false -> true this means it must be expanded **/
    const setIsReplying: Setter<boolean> = (val) => {
      batch(() => {
        const next: boolean =
          typeof val === 'function' ? val(isReplying()) : val;
        if (next) setIsExpanded(true);
        setIsReplyingRaw(next);
      });
    };

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
