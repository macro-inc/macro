import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/component/ChatWithAgentButton';
import {
  type BlockTool,
  ToolButton,
} from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import {
  setShowCommentsPreference,
  showCommentsPreference,
} from '@block-md/comments/commentStore';
import { useDownloadDocumentAsMarkdownText } from '@block-md/signal/save';
import { useIsAuthenticated } from '@core/auth';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsButton } from '@core/component/NotificationsModal';
import { NOTIFICATIONS_DRAWER_ID } from '@core/component/NotificationsModal';
import { ReferencesButton } from '@core/component/ReferencesModal';
import { REFERENCES_DRAWER_ID } from '@core/component/ReferencesModal';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import {
  ENABLE_HISTORY_COMPONENT,
  ENABLE_MARKDOWN_LIVE_COLLABORATION,
  ENABLE_REFERENCES_MODAL,
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
import GitBranch from '@icon/regular/git-branch.svg';
import Info from '@icon/regular/info.svg';
import Bell from '@icon/regular/bell.svg';
import Quotes from '@icon/regular/quotes.svg';
import TerminalWindowIcon from '@icon/regular/terminal-window.svg';
import IconShared from '@macro-icons/wide/share.svg';
import IconLink from '@icon/regular/link.svg';
import ClockIcon from '@icon/regular/clock-counter-clockwise.svg';
import TagIcon from '@icon/regular/tag.svg';
import { blockNameToItemType } from '@service-storage/client';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { TOKENS } from '@core/hotkey/tokens';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import { createEffect, For, on, Show, type JSX } from 'solid-js';
import { DispatchAgentButton } from './DispatchAgentMenu';
import { HISTORY_DRAWER_ID } from './History';
import { DRAWER_ID as PROPERTIES_DRAWER_ID } from './MarkdownPropertiesModal';
import { useAnalytics } from '@app/component/analytics-context';

export function TopBar() {
  const analytics = useAnalytics();

  const isAuth = useIsAuthenticated();

  const canEdit = useCanEdit();
  const blockName = useBlockName();
  const blockId = useBlockId();
  const scopeId = blockHotkeyScopeSignal.get;
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
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();
  const blockAliasedName = useBlockAliasedName();
  const isTask = blockAliasedName === 'task';

  const copyLink = () => {
    const url = buildSimpleEntityUrl({ id: blockId, type: blockAliasedName });
    navigator.clipboard.writeText(url);
    toast.success(
      'Link copied to clipboard.',
      'Sending this link in a Macro message will automatically update permissions to include recipients.'
    );
  };

  const copyBranchName = () => copyBranchNameToClipboard(blockId);

  if (isTask) {
    let cleanupKbShortcut = () => {};

    createEffect(
      on(scopeId, (id) => {
        cleanupKbShortcut();
        registerHotkey({
          hotkey: 'shift+cmd+b',
          scopeId: id,
          hotkeyToken: TOKENS.entity.action.copyBranchName,
          description: 'Copy branch name',
          keyDownHandler: () => {
            copyBranchName();
            return true;
          },
          runWithInputFocused: true,
        });
      })
    );
  }

  const ops: FileOperation[] = [
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
    { op: 'copy', divideAbove: true },
    { op: 'rename' },
    { op: 'moveToProject' },
    ...(isTask
      ? ([
          {
            label: 'Copy Branch Name',
            icon: GitBranch,
            action: copyBranchName,
          },
        ] satisfies FileOperation[])
      : []),
    {
      label: 'Download',
      icon: Download,
      action: downloadAsMarkdownText,
      divideAbove: true,
    },
    { op: 'delete', divideAbove: true },
  ];

  const tools: BlockTool[] = [
    {
      label: 'History',
      icon: ClockIcon,
      action: historyControl.toggle,
      isActive: historyControl.isOpen,
      condition: () =>
        ENABLE_MARKDOWN_LIVE_COLLABORATION &&
        ENABLE_HISTORY_COMPONENT &&
        canEdit(),
    },
    {
      label: 'Notifications',
      icon: Bell,
      action: notificationsControl.toggle,
      condition: () => !!isAuth(),
      buttonComponent: () => (
        <NotificationsButton
          entity={{ id: blockId, type: itemType as EntityType }}
          notificationSource={notificationSource}
          onOpenChange={(open) =>
            open &&
            analytics.track('notifications_panel_open', { blockType: 'md' })
          }
        />
      ),
    },
    {
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
      buttonComponent: () => (
        <ReferencesButton
          documentId={blockId}
          documentName={name()}
          buttonSize="sm"
          onOpenChange={(open) =>
            open &&
            analytics.track('references_panel_open', { blockType: 'md' })
          }
        />
      ),
    },
    {
      label: () =>
        showCommentsPreference() ? 'Hide Comments' : 'Show Comments',
      icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => (
        <Show
          when={showCommentsPreference()}
          fallback={<ShowComments {...props} />}
        >
          <HideComments {...props} />
        </Show>
      ),
      action: () => setShowCommentsPreference(!showCommentsPreference()),
    },
    {
      label: 'Copy Branch Name',
      icon: GitBranch,
      action: copyBranchName,
      condition: () => isTask,
      hotkeyToken: TOKENS.entity.action.copyBranchName,
    },
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      isActive: propertiesControl.isOpen,
    },
    {
      label: 'Dispatch to Agent',
      icon: TerminalWindowIcon,
      action: () => {},
      condition: () => isTask && !isMobile(),
      buttonComponent: () => <DispatchAgentButton />,
    },
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: blockId,
          name: name(),
          fileType: 'md',
        }),
      divideAbove: true,
      buttonComponent: () => (
        <ChatWithAgentButton
          entity={{
            type: 'document',
            id: blockId,
            name: name(),
            fileType: 'md',
          }}
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
    {
      label: 'Copy Link',
      icon: IconLink,
      action: copyLink,
      condition: isMobile,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <div class="-order-1">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType={itemType}
        name={name()}
      />
    </>
  );
}

export function InstructionsTopBar() {
  const canEdit = useCanEdit();
  const historyControl = useDrawerControl(HISTORY_DRAWER_ID);

  const tools: BlockTool[] = [
    {
      label: 'History',
      icon: ClockIcon,
      action: historyControl.toggle,
      isActive: historyControl.isOpen,
      condition: () =>
        ENABLE_MARKDOWN_LIVE_COLLABORATION &&
        ENABLE_HISTORY_COMPONENT &&
        canEdit(),
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="AI Instructions" iconType="md" />
      </SplitHeaderLeft>
      <For each={tools}>
        {(tool) => (
          <Show when={!tool.condition || tool.condition()}>
            {tool.buttonComponent ? (
              <tool.buttonComponent />
            ) : (
              <ToolButton tool={tool} />
            )}
          </Show>
        )}
      </For>
    </>
  );
}
