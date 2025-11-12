import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import {
  setShowCommentsPreference,
  showCommentsPreference,
} from '@block-md/comments/commentStore';
import { useDownloadDocumentAsMarkdownText } from '@block-md/signal/save';
import { useBlockId, useBlockName } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsModal } from '@core/component/NotificationsModal';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_HISTORY_COMPONENT,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  ENABLE_PROPERTIES_METADATA,
} from '@core/constant/featureFlags';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import type { EntityType } from '@core/types';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import ShowComments from '@icon/regular/chat-circle-dots.svg';
import HideComments from '@icon/regular/chat-circle-slash.svg';
import Download from '@icon/regular/download.svg';
import { blockNameToItemType } from '@service-storage/client';
import { Show } from 'solid-js';
import { HistoryModal } from './History';
import { MarkdownPropertiesModal } from './MarkdownPropertiesModal';

export function TopBar() {
  const canEdit = useCanEdit();
  const blockName = useBlockName();
  const blockId = useBlockId();
  const permissions = useGetPermissions();
  const name = useBlockDocumentName();
  const notificationSource = useGlobalNotificationSource();
  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

  const downloadAsMarkdownText = useDownloadDocumentAsMarkdownText();

  const ops: FileOperation[] = [
    { op: 'pin' },
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    {
      label: 'Download',
      icon: Download,
      action: downloadAsMarkdownText,
      divideAbove: true,
    },
    { op: 'delete', divideAbove: true },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="flex h-full">
          <EntityNavigationIndicator />
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <SplitToolbarLeft>
        <SplitFileMenu
          id={blockId}
          itemType={itemType}
          name={name()}
          ops={ops}
        />
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <Show
            when={
              ENABLE_MARKDOWN_LIVE_COLLABORATION &&
              ENABLE_HISTORY_COMPONENT &&
              canEdit()
            }
          >
            <HistoryModal documentId={blockId} />
          </Show>
          <NotificationsModal
            entity={{ id: blockId, type: itemType as EntityType }}
            notificationSource={notificationSource}
            buttonSize="sm"
          />
          <ReferencesModal
            documentId={blockId}
            documentName={name()}
            buttonSize="sm"
          />
          <IconButton
            size="sm"
            icon={showCommentsPreference() ? HideComments : ShowComments}
            theme="clear"
            onClick={() => setShowCommentsPreference(!showCommentsPreference())}
            tooltip={{
              label: `${showCommentsPreference() ? 'Hide' : 'Show'} Comments`,
            }}
          />
          <Show when={ENABLE_PROPERTIES_METADATA}>
            <MarkdownPropertiesModal documentId={blockId} buttonSize="sm" />
          </Show>
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <ShareButton
              id={blockId}
              name={name()}
              userPermissions={permissions()}
              itemType={itemType}
            />
          </div>
        </div>
      </SplitToolbarRight>
    </>
  );
}

export function InstructionsTopBar() {
  const canEdit = useCanEdit();
  const blockId = useBlockId();
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="AI Instructions" iconType="md" />
      </SplitHeaderLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <Show
            when={
              ENABLE_MARKDOWN_LIVE_COLLABORATION &&
              ENABLE_HISTORY_COMPONENT &&
              canEdit()
            }
          >
            <HistoryModal documentId={blockId} />
          </Show>
        </div>
      </SplitToolbarRight>
    </>
  );
}
