import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { Permissions } from '@core/component/SharePermissions';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import {
  enableHistoryComponent,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import ClockCounterClockwise from '@icon/system/regular/clock-counter-clockwise.svg';
import Copy from '@icon/system/regular/copy.svg';
import Download from '@icon/system/regular/download.svg';
import GitBranch from '@icon/system/regular/git-branch.svg';
import IconLink from '@icon/system/regular/link.svg';
import TerminalWindowIcon from '@icon/system/regular/terminal-window.svg';
import { queryReadyGate } from '@queries/gate';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useHistory } from '../history/HistoryContext';
import { useDispatchAgentSplitFileActions } from './DispatchAgentMenu';
import { useMarkdownName } from './MarkdownNameProvider';
import {
  useCopyDocumentAsMarkdown,
  useDownloadDocumentAsMarkdownText,
} from './useMarkdownDocumentDownload';

function useMarkdownShareModal() {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const metadataQuery = useDocumentMetadataQuery(documentId);

  const userPermissions = () => {
    if (permissions.isOwner()) return Permissions.OWNER;
    if (permissions.canEdit()) return Permissions.CAN_EDIT;
    if (permissions.canComment()) return Permissions.CAN_COMMENT;
    return Permissions.CAN_VIEW;
  };

  return useShareModal(() => {
    const documentKind = kind();
    return {
      id: documentId(),
      blockAlias: documentKind === 'document' ? 'md' : documentKind,
      itemType: 'document',
      name: displayName() ?? '',
      userPermissions: userPermissions(),
      owner: queryReadyGate(metadataQuery)
        ? metadataQuery.data.owner
        : undefined,
    };
  });
}

export function useMarkdownDocumentTools() {
  const { documentId, kind, element } = useMarkdownDocument();
  const history = useHistory();
  const { displayName } = useMarkdownName();
  const copyAsMarkdown = useCopyDocumentAsMarkdown();
  const downloadAsMarkdownText = useDownloadDocumentAsMarkdownText();
  const openShare = useMarkdownShareModal();
  const dispatchAgentActions = useDispatchAgentSplitFileActions();
  const isTask = kind() === 'task';
  const isDocument = kind() === 'document';

  const chatEntity = () => ({
    type: 'document' as const,
    id: documentId(),
    name: displayName() ?? '',
    fileType: 'md' as const,
  });
  const copyBranchName = () => copyBranchNameToClipboard(documentId());

  const fileOperations: FileOperation[] = [
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    ...(isTask
      ? ([
          {
            group: 'sharing' as const,
            label: 'Copy Branch Name',
            icon: GitBranch,
            action: copyBranchName,
          },
        ] satisfies FileOperation[])
      : []),
    ...(isDocument
      ? ([
          {
            group: 'sharing' as const,
            label: 'Copy as markdown',
            icon: Copy,
            action: copyAsMarkdown,
          },
        ] satisfies FileOperation[])
      : []),
    {
      group: 'file',
      label: 'Download',
      icon: Download,
      action: downloadAsMarkdownText,
    },
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent(chatEntity()),
      buttonComponent: () => <ChatWithAgentButton entity={chatEntity()} />,
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconLink,
      action: openShare,
      buttonComponent: () => <ShareTrigger onClick={openShare} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  const menuTools: BlockTool[] = [
    {
      group: 'file',
      label: 'History',
      icon: ClockCounterClockwise,
      condition: () => !isMobile() && isFeatureEnabled(enableHistoryComponent),
      action: () => history.enter(),
      focusTarget: () =>
        element()?.querySelector<HTMLElement>('[data-history-close]') ?? null,
    },
    {
      label: 'Ask AI',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent(chatEntity()),
    },
    ...(isTask
      ? ([
          {
            label: 'Code Actions',
            icon: TerminalWindowIcon,
            action: () => {},
            children: dispatchAgentActions.all,
          },
        ] satisfies BlockTool[])
      : []),
  ];

  return { fileOperations, menuTools, tools };
}
