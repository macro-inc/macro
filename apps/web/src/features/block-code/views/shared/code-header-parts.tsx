import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal, blockTextSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import Download from '@icon/system/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { CodeBlockMode } from '../../component/CodeContent';

export interface CodeHeaderProps {
  isHtmlFile: boolean;
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}

/** The code block's title menu operations and named header actions. */
export function useCodeHeaderTools() {
  const analytics = useAnalytics();

  const blockId = useBlockId();
  const text = blockTextSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const blockAlias = useBlockAliasedName();
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias,
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const downloadDocument = createCallback(() => {
    const content = text();
    if (!text || !name) return;
    const file = new Blob([content ?? ''], { type: 'text/plain' });
    fireAndForget(downloadFile(file, downloadName()), 'code-top-bar');
    analytics.track('download', { blockType: 'code' });
  });

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: Download,
      action: downloadDocument,
    },
    { op: 'delete' },
  ];

  const chatEntity = () => ({
    type: 'document' as const,
    id: blockId,
    name: name() ?? '',
    fileType: 'code',
  });

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () => openChatWithAgent(chatEntity()),
    buttonComponent: (control) => (
      <ChatWithAgentButton
        grouped={control.grouped}
        entity={chatEntity()}
        label="Ask Macro"
      />
    ),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, openShare, actions: { askMacro, share } };
}
