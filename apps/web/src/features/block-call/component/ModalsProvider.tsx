import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
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
      <ShareBlockModal />
    </ShareDialogContext.Provider>
  );
}
