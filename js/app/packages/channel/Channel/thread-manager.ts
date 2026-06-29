import type { InputHandle, InputSnapshot } from '@channel/Input';
import { batch, createSignal, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ThreadState } from '../Thread';
import { createFocusRequest } from '../Thread/focus-request';

type ThreadStore = Record<string, ThreadState>;

export type ThreadStateSnapshot = {
  isExpanded?: boolean;
  isReplying?: boolean;
};

export type ThreadManagerSnapshot = Record<string, ThreadStateSnapshot>;

export function createThreadManager(initialSnapshot?: ThreadManagerSnapshot) {
  const [threadStore, setThreadStore] = createStore<ThreadStore>({});

  function initThreadState(threadId: string): ThreadState {
    const snapshot = initialSnapshot?.[threadId];
    const initialIsReplying = snapshot?.isReplying ?? false;
    const [isExpanded, setIsExpanded] = createSignal<boolean>(
      snapshot?.isExpanded || initialIsReplying
    );
    const [isReplying, setIsReplyingRaw] =
      createSignal<boolean>(initialIsReplying);
    const [replyInputState, setReplyInputState] = createSignal<
      InputSnapshot | undefined
    >();
    const [replyInputEl, setReplyInputEl] = createSignal<
      HTMLElement | undefined
    >();
    const [replyInputHandle, setReplyInputHandle] = createSignal<
      InputHandle | undefined
    >();
    const replyInputFocusRequest = createFocusRequest();

    /** If you set replying from false -> true this means it must be expanded **/
    const setIsReplying: Setter<boolean> = (val) => {
      batch(() => {
        const next: boolean =
          typeof val === 'function' ? val(isReplying()) : val;
        if (next) {
          setIsExpanded(true);
          requestAnimationFrame(() =>
            replyInputEl()?.scrollIntoView({ block: 'nearest' })
          );
        }
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
      replyInputEl,
      setReplyInputEl,
      replyInputHandle,
      setReplyInputHandle,
      replyInputFocusRequest,
    };

    setThreadStore(threadId, state);

    return state;
  }

  function getOrCreateThreadState(threadId: string): ThreadState {
    const threadState = threadStore[threadId];

    if (threadState) return threadState;

    return initThreadState(threadId);
  }

  // Passed up via messagesHandle to get called by split history captor on navigation, so that we can restore thread state on history navigation
  function getSnapshot(): ThreadManagerSnapshot | undefined {
    const snapshot: ThreadManagerSnapshot = { ...(initialSnapshot ?? {}) };

    for (const [threadId, state] of Object.entries(threadStore)) {
      const isExpanded = state.isExpanded();
      const isReplying = state.isReplying();
      if (!isExpanded && !isReplying) {
        delete snapshot[threadId];
        continue;
      }

      snapshot[threadId] = {
        ...(isExpanded ? { isExpanded } : {}),
        ...(isReplying ? { isReplying } : {}),
      };
    }

    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  }

  return {
    getOrCreateThreadState,
    getSnapshot,
  };
}
