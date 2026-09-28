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
import { isMobile } from '@core/mobile/isMobile';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import Download from '@phosphor/download.svg';
import GitBranch from '@phosphor/git-branch.svg';
import IconLink from '@phosphor/link.svg';
import TerminalWindowIcon from '@phosphor/terminal-window.svg';
import { queryReadyGate } from '@queries/gate';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { useMarkdownDocument } from '../context/markdown-document-context';
import {
  DispatchAgentButton,
  useDispatchAgentSplitFileActions,
} from './DispatchAgentMenu';
import { useMarkdownName } from './MarkdownNameProvider';
import { useDownloadDocumentAsMarkdownText } from './useMarkdownDocumentDownload';

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
  const { documentId, kind } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const downloadAsMarkdownText = useDownloadDocumentAsMarkdownText();
  const openShare = useMarkdownShareModal();
  const dispatchAgentActions = useDispatchAgentSplitFileActions();
  const isTask = kind() === 'task';

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
      label: 'Dispatch to Agent',
      icon: TerminalWindowIcon,
      action: () => {},
      condition: () => isTask && !isMobile(),
      buttonComponent: () => <DispatchAgentButton />,
    },
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
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent(chatEntity()),
    },
    ...(isTask
      ? ([
          {
            label: 'Code Actions',
            icon: TerminalWindowIcon,
            action: () => {},
            children: dispatchAgentActions,
          },
        ] satisfies BlockTool[])
      : []),
  ];

  return { fileOperations, menuTools, tools };
}
