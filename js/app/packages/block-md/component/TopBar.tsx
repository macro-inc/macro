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
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsButton } from '@core/component/NotificationsModal';
import { ReferencesButton } from '@core/component/ReferencesModal';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_HISTORY_COMPONENT,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
} from '@core/constant/featureFlags';
import { useCanEdit } from '@core/signal/permissions';
import type { EntityType } from '@core/types';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import ShowComments from '@icon/regular/chat-circle-dots.svg';
import HideComments from '@icon/regular/chat-circle-slash.svg';
import Download from '@icon/regular/download.svg';
import { blockNameToItemType } from '@service-storage/client';
import { Show } from 'solid-js';
import { HistoryButton } from './History';
import { MarkdownPropertiesButton } from './MarkdownPropertiesModal';

export function TopBar() {
  const canEdit = useCanEdit();
  const blockName = useBlockName();
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const notificationSource = useGlobalNotificationSource();
  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

  const downloadAsMarkdownText = useDownloadDocumentAsMarkdownText();

  const ops: FileOperation[] = [
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
        <BlockLiveIndicators />
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
        <Show
          when={
            ENABLE_MARKDOWN_LIVE_COLLABORATION &&
            ENABLE_HISTORY_COMPONENT &&
            canEdit()
          }
        >
          <HistoryButton buttonSize="sm" />
        </Show>
        <NotificationsButton
          entity={{ id: blockId, type: itemType as EntityType }}
          notificationSource={notificationSource}
          buttonSize="sm"
        />
        <ReferencesButton
          documentId={blockId}
          documentName={name()}
          buttonSize="sm"
        />
        <DeprecatedIconButton
          size="sm"
          icon={showCommentsPreference() ? HideComments : ShowComments}
          theme="clear"
          onClick={() => setShowCommentsPreference(!showCommentsPreference())}
          tooltip={{
            label: `${showCommentsPreference() ? 'Hide' : 'Show'} Comments`,
          }}
        />
        <MarkdownPropertiesButton buttonSize="sm" />
        <div class="flex items-center">
          <SplitPermissionsBadge />
          <ShareTrigger />
        </div>
      </SplitToolbarRight>
    </>
  );
}

export function InstructionsTopBar() {
  const canEdit = useCanEdit();
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="AI Instructions" iconType="md" />
      </SplitHeaderLeft>
      <SplitToolbarRight>
        <Show
          when={
            ENABLE_MARKDOWN_LIVE_COLLABORATION &&
            ENABLE_HISTORY_COMPONENT &&
            canEdit()
          }
        >
          <HistoryButton />
        </Show>
      </SplitToolbarRight>
    </>
  );
}
