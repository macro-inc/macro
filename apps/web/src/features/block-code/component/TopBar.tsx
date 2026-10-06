import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal, blockTextSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import Download from '@phosphor/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { CodeFileTypeChip } from './CodeFileTypeChip';

export function TopBar() {
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
    downloadFile(file, downloadName());
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

  const tools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () => openChatWithAgent(chatEntity()),
      buttonComponent: () => (
        <ChatWithAgentButton entity={chatEntity()} label="Ask Macro" />
      ),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      buttonComponent: () => <ShareTrigger onClick={openShare} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<CodeFileTypeChip />} />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name()}
      />
    </>
  );
}
