import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { ParentProps } from 'solid-js';

export function ModalsMounter(props: ParentProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  return (
    <>
      {props.children}
      <ReferencesDrawer
        documentId={blockId}
        documentName={name()}
        entityType="chat"
      />
    </>
  );
}
