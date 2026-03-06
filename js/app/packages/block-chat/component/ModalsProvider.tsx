import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
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
      <ReferencesDrawer
        documentId={blockId}
        documentName={name()}
        entityType="chat"
      />
      <ShareBlockModal />
    </ShareDialogContext.Provider>
  );
}
