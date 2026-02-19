import { useBlockId } from '@core/block';
import { DocumentPropertiesDrawer } from '@core/component/DocumentPropertiesModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { ParentProps } from 'solid-js';

export function ModalsMounter(props: ParentProps) {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  return (
    <>
      {props.children}
      <ReferencesDrawer documentId={documentId} documentName={fileName()} />
      <DocumentPropertiesDrawer blockType="canvas" />
    </>
  );
}
