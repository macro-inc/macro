import { useBlockId } from '@core/block';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { ParentProps } from 'solid-js';

export function ModalsMounter(props: ParentProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  return (
    <>
      {props.children}
      <ReferencesDrawer documentId={blockId} documentName={name()} />
    </>
  );
}
