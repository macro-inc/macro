import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData } from '@entity';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import type { CallRecord } from '@service-call/client';
import { callRecordingDownloadSource } from '../../queries/recording-download';

/**
 * The call recording block's title menu operations, its entity for the
 * menu, and its named header actions.
 */
export function useCallRecordingHeaderTools(record: () => CallRecord) {
  const blockId = useBlockId();
  const callName = () => record().customName ?? record().channelName ?? 'Call';
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'call',
    itemType: 'call',
    name: callName(),
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  const recordingDownload = createFileDownload(() =>
    callRecordingDownloadSource(record(), callName())
  );
  const ops = (): FileOperation[] => [
    { op: 'rename' },
    ...(record().recordingUrl
      ? [
          {
            group: 'file' as const,
            label: 'Download',
            icon: DownloadSimple,
            action: () =>
              fireAndForget(
                recordingDownload.start(),
                'call-recording-download'
              ),
          },
        ]
      : []),
    { op: 'delete' },
  ];

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () =>
      openChatWithAgent({
        type: 'document',
        id: blockId,
        name: callName(),
        fileType: 'call',
      }),
  };

  const share: BlockTool = {
    label: 'Share',
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  // Supply the record's current status and optional channel association.
  const entity = () =>
    buildEntityData({
      id: record().callId,
      name: callName(),
      blockName: 'call',
      channelId: record().channelId,
      isActive: record().isActive,
      status: record().status ?? undefined,
    });

  return {
    blockId,
    callName,
    ops,
    openShare,
    entity,
    actions: { askMacro, share },
  };
}
