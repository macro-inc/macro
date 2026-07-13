import { useScrollToCommentThread } from '@block-md/comments/commentOperations';
import { activeCommentThreadSignal } from '@block-md/comments/commentStore';
import {
  setTempRedirectLocation,
  type TempRedirectLocation,
} from '@core/signal/location';

export const useGoToTempRedirect = () => {
  const [, setActiveThreadId] = activeCommentThreadSignal;
  const scrollToCommentThread = useScrollToCommentThread();

  return (documentId: string, state: TempRedirectLocation) => {
    if (state.itemId !== documentId) {
      return;
    }
    setTempRedirectLocation(undefined);

    const threadId = state.location?.threadId;
    if (!threadId) return;

    scrollToCommentThread(threadId).then(() => {
      // NOTE: in commentStore.ts, we unset the active thread id
      // if there are no active mark ids. By setting it after
      // scroll we ensure that the active thread id is not unset
      setActiveThreadId(threadId);
    });
  };
};
