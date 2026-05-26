import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { useEmailContext } from './EmailContext';

export function ModalsProvider(props: ParentProps<{ subject?: string }>) {
  const email = useEmailContext();
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
          userPermissions={email.permissions().type}
        />
      </Show>
    </ShareDialogContext.Provider>
  );
}
