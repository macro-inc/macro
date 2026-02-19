import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockId, useBlockName } from '@core/block';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import type { EntityType } from '@core/types';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { blockNameToItemType } from '@service-storage/client';
import type { ParentProps } from 'solid-js';
import { HistoryDrawer } from './History';
import { MarkdownPropertiesDrawer } from './MarkdownPropertiesModal';

export function ModalsMounter(props: ParentProps) {
  const blockId = useBlockId();
  const blockName = useBlockName();
  const name = useBlockDocumentName();
  const notificationSource = useGlobalNotificationSource();

  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

  return (
    <>
      {props.children}
      <NotificationsDrawer
        entity={{ id: blockId, type: itemType as EntityType }}
        notificationSource={notificationSource}
      />
      <ReferencesDrawer documentId={blockId} documentName={name()} />
      <HistoryDrawer documentId={blockId} />
      <MarkdownPropertiesDrawer documentId={blockId} />
    </>
  );
}
