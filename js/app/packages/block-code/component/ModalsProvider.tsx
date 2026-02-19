import { useBlockId } from '@core/block';
import { DocumentPropertiesDrawer } from '@core/component/DocumentPropertiesModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
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
      <ReferencesDrawer documentId={blockId} documentName={name()} />
      <DocumentPropertiesDrawer blockType="code" />
      <ShareBlockModal />
    </ShareDialogContext.Provider>
  );
}
