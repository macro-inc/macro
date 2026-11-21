import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
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

/** The image block's title menu operations and named header actions. */
export function useImageHeaderTools() {
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
      get label() {
        return t('entityActions.download');
      },
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

  const askMacro: BlockTool = {
    label: () => t('entityActions.askMacro'),
    icon: ChatWithAgentIcon,
    action: () => openChatWithAgent(chatEntity()),
    buttonComponent: (control) => (
      <ChatWithAgentButton
        grouped={control.grouped}
        entity={chatEntity()}
        label={t('entityActions.askMacro')}
      />
    ),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: () => t('entityActions.share'),
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, openShare, actions: { askMacro, share } };
}
