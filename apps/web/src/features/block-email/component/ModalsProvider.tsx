import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { getPermissions } from '@core/component/SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import {
  createSignal,
  type ParentProps,
  type Setter,
  Show,
  Suspense,
} from 'solid-js';

export function ModalsProvider(
  props: ParentProps<{
    threadId: string;
    subject?: string;
    shareOpen?: boolean;
    onShareOpenChange?: (open: boolean) => void;
  }>
) {
  const email = useEmailThreadState();
  const [localShareOpen, setLocalShareOpen] = createSignal(false);
  const shareOpen = () => props.shareOpen ?? localShareOpen();
  const setShareOpen: Setter<boolean> = (next) => {
    const open = typeof next === 'function' ? next(shareOpen()) : next;
    props.onShareOpenChange?.(open);
    if (props.shareOpen === undefined) setLocalShareOpen(() => open);
    return open;
  };

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      {props.children}
      <Show when={ENABLE_EMAIL_SHARING}>
        <Suspense>
          <ShareModal
            isSharePermOpen={shareOpen()}
            setIsSharePermOpen={setShareOpen}
            id={props.threadId}
            blockAlias="email"
            itemType="email"
            name={props.subject ?? ''}
            userPermissions={getPermissions(email.thread()?.access_level)}
          />
        </Suspense>
      </Show>
    </ShareDialogContext.Provider>
  );
}
