import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  type FileOperation,
  SplitFileMenu,
  type FileTools,
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
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import {
  setShowCommentsPreference,
  showCommentsPreference,
} from '@block-md/comments/commentStore';
import { useDownloadDocumentAsMarkdownText } from '@block-md/signal/save';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsButton } from '@core/component/NotificationsModal';
import { NOTIFICATIONS_DRAWER_ID } from '@core/component/NotificationsModal';
import { ReferencesButton } from '@core/component/ReferencesModal';
import { REFERENCES_DRAWER_ID } from '@core/component/ReferencesModal';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import {
  ENABLE_HISTORY_COMPONENT,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { useCanEdit } from '@core/signal/permissions';
import { toast } from '@core/component/Toast/Toast';
import type { EntityType } from '@core/types';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import ShowComments from '@icon/regular/chat-circle-dots.svg';
import HideComments from '@icon/regular/chat-circle-slash.svg';
import Download from '@icon/regular/download.svg';
import Bell from '@icon/regular/bell.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@icon/regular/share.svg';
import IconLink from '@icon/regular/link.svg';
import ClockIcon from '@icon/regular/clock-counter-clockwise.svg';
import TagIcon from '@icon/regular/tag.svg';
import { blockNameToItemType } from '@service-storage/client';
import { Show } from 'solid-js';
import { HistoryButton } from './History';
import { HISTORY_DRAWER_ID } from './History';
import { MarkdownPropertiesButton } from './MarkdownPropertiesModal';
import { DRAWER_ID as PROPERTIES_DRAWER_ID } from './MarkdownPropertiesModal';

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

  const historyControl = useDrawerControl(HISTORY_DRAWER_ID);
  const notificationsControl = useDrawerControl(NOTIFICATIONS_DRAWER_ID);
  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const shareCtx = useShareDialogContext();
  const blockAliasedName = useBlockAliasedName();

  const copyLink = () => {
    const url = buildSimpleEntityUrl(
      { id: blockId, type: blockAliasedName },
      {}
    );
    navigator.clipboard.writeText(url);
    toast.success(
      'Link copied to clipboard.',
      'Sending this link in a Macro message will automatically update permissions to include recipients.'
    );
  };

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

  const tools: FileTools[] = [
    {
      label: 'History',
      icon: ClockIcon,
      action: historyControl.toggle,
      condition: () =>
        ENABLE_MARKDOWN_LIVE_COLLABORATION &&
        ENABLE_HISTORY_COMPONENT &&
        canEdit(),
    },
    { label: 'Notifications', icon: Bell, action: notificationsControl.toggle },
    { label: 'References', icon: Quotes, action: referencesControl.toggle },
    {
      label: 'Show Comments',
      icon: ShowComments,
      action: () => setShowCommentsPreference(true),
      condition: () => !showCommentsPreference(),
    },
    {
      label: 'Hide Comments',
      icon: HideComments,
      action: () => setShowCommentsPreference(false),
      condition: () => showCommentsPreference(),
    },
    { label: 'Properties', icon: TagIcon, action: propertiesControl.toggle },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
    },
    { label: 'Copy Link', icon: IconLink, action: copyLink },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
        <Show when={isMobile()}>
          <SplitPermissionsBadge />
        </Show>
      </SplitHeaderLeft>

      <Show
        when={isMobile()}
        fallback={
          <>
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
                onClick={() =>
                  setShowCommentsPreference(!showCommentsPreference())
                }
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
        }
      >
        {/* Mobile layout */}
        <SplitHeaderRight>
          <BlockLiveIndicators />
          <SplitFileMenu
            id={blockId}
            itemType={itemType}
            name={name()}
            ops={ops}
            tools={tools}
          />
        </SplitHeaderRight>
      </Show>
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
