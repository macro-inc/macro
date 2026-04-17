import { useBlockId } from '@core/block';
import { DetailsDrawer } from '@core/component/DetailsDrawer';
import { DocumentPropertiesDrawer } from '@core/component/DocumentPropertiesModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
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
      <ReferencesDrawer documentId={documentId} documentName={fileName()} />
      <DocumentPropertiesDrawer blockType="pdf" />
      <DetailsDrawer documentId={documentId} />
      <ShareBlockModal name={fileName()} />
    </ShareDialogContext.Provider>
  );
}
