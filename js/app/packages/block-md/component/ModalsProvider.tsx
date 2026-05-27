import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockId, useBlockName } from '@core/block';
import { DetailsDrawer } from '@core/component/DetailsDrawer';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import { ReferencesDrawer } from '@core/component/ReferencesModal';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import type { EntityType } from '@core/types';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { blockNameToItemType } from '@service-storage/client';
import { createSignal, type ParentProps } from 'solid-js';
import { HistoryDrawer } from './History';

export function ModalsProvider(props: ParentProps) {
  const blockId = useBlockId();
  const blockName = useBlockName();
  const name = useBlockDocumentName();
  const notificationSource = useGlobalNotificationSource();

  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

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
      <NotificationsDrawer
        entity={{ id: blockId, type: itemType as EntityType }}
        notificationSource={notificationSource}
      />
      <ReferencesDrawer documentId={blockId} documentName={name()} />
      <HistoryDrawer documentId={blockId} />
      <DetailsDrawer documentId={blockId} />
      <ShareBlockModal />
    </ShareDialogContext.Provider>
  );
}
