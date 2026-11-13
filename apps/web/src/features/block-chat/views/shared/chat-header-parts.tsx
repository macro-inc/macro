import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import type { Model } from '@core/component/AI/types';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import IconShared from '@icon/share.svg';
import ChatDebugIcon from '@icon/system/regular/chat-text.svg';
import type { Accessor } from 'solid-js';

export interface ChatHeaderProps {
  model: Model;
  showStreamDebug?: Accessor<boolean>;
  toggleStreamDebug?: () => void;
}

/** The chat block's title menu operations and named header actions. */
export function useChatHeaderTools(props: ChatHeaderProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'chat',
    itemType: 'chat',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const ops: FileOperation[] = [
    ...(DEV_MODE_ENV && props.toggleStreamDebug
      ? [
          {
            label: props.showStreamDebug?.()
              ? 'Hide Stream Debug'
              : 'Show Stream Debug',
            icon: ChatDebugIcon,
            action: props.toggleStreamDebug,
          } satisfies FileOperation,
        ]
      : []),
    { op: 'rename' },
    { op: 'moveToProject' },
    { op: 'delete' },
  ];

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { blockId, name, ops, openShare, actions: { share } };
}
