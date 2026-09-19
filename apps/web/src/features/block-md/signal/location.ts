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

    scrollToCommentThread(threadId).then((completed) => {
      // A mobile wait that was cancelled (superseded by a newer deep link,
      // or the block unmounting) resolves false — activating its thread
      // would overwrite the navigation that superseded it.
      if (completed === false) return;
      // NOTE: in commentStore.ts, we unset the active thread id
      // if there are no active mark ids. By setting it after
      // scroll we ensure that the active thread id is not unset
      setActiveThreadId(threadId);
    });
  };
};
