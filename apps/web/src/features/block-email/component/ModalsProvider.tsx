import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { getPermissions } from '@core/component/SharePermissions';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { createSignal, type ParentProps, Show } from 'solid-js';

export function ModalsProvider(props: ParentProps<{ subject?: string }>) {
  const email = useEmailThreadState();
  const [shareOpen, setShareOpen] = createSignal(false);
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
        <ShareBlockModal
          name={props.subject}
          userPermissions={getPermissions(email.thread()?.access_level)}
        />
      </Show>
    </ShareDialogContext.Provider>
  );
}
