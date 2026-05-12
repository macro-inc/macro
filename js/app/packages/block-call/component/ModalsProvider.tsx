import { useBlockId } from '@core/block';
import { DetailsDrawer } from '@core/component/DetailsDrawer';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
  const blockId = useBlockId();
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
      <DetailsDrawer documentId={blockId} />
      <ShareBlockModal />
    </ShareDialogContext.Provider>
  );
}
