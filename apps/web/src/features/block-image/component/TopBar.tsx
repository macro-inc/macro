import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';

import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import Download from '@icon/system/regular/download.svg';
import { createCallback } from '@solid-primitives/rootless';

export function TopBar() {
  const blockId = useBlockId();
  const imageFile = blockFileSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'image',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const downloadDocument = createCallback(async () => {
    const file = imageFile();
    if (!file) return;
    fireAndForget(downloadFile(file, downloadName()), 'image-top-bar');
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
    fileType: 'image',
  });

  const tools: BlockTool[] = [
    {
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
        <BlockItemSplitLabel badges={<FileTypeChip />} />
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
