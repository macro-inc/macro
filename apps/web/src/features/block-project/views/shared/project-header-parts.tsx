import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { projectBlockDataSignal } from '@block-project/signal/projectBlockData';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import {
  useCanEdit,
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import IconShared from '@icon/share.svg';
import { createMemo } from 'solid-js';
import { useProjectCreateTools } from '../../component/ProjectCreateMenu';

// TODO (SEAMUS) : Revisit this file when we figure out what we wanna do
//     with folder block.

/**
 * The project block's title menu operations, its Create tools and dialog,
 * and its named header actions.
 */
export function useProjectHeaderTools() {
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const isOwner = useIsDocumentOwner();
  const canEdit = useCanEdit();
  const name = createMemo(
    () => projectBlockDataSignal()?.projectMetadata.name ?? ''
  );

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id,
    blockAlias: 'project',
    itemType: 'project',
    name: name(),
    userPermissions: permissions(),
    owner: projectBlockDataSignal()?.projectMetadata.userId,
  }));
  const copyLink = useCopyLink();
  const handleCopyLink = () =>
    copyLink(buildSimpleEntityUrl({ type: 'project', id }));

  const ops = createMemo<FileOperation[]>(() => [
    ...(isOwner() && !isSpecialProject
      ? [
          { op: 'rename' as const },
          { op: 'copy' as const },
          { op: 'moveToProject' as const },
          { op: 'delete' as const },
        ]
      : []),
  ]);

  const { tools: createTools, CreateDialog } = useProjectCreateTools(
    id,
    name,
    canEdit
  );

  const chat: BlockTool = {
    label: 'Chat',
    icon: ChatWithAgentIcon,
    action: () => openChatWithAgent({ type: 'project', id, name: name() }),
    condition: () => !isSpecialProject,
    buttonComponent: (control) => (
      <ChatWithAgentButton
        grouped={control.grouped}
        size={control.grouped ? 'md' : undefined}
        entity={{ type: 'project', id, name: name() }}
      />
    ),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    condition: () => showShare(),
    focusTarget: getShareDrawerRecipientInput,
  };
  const showShare = () => ENABLE_PROJECT_SHARING && !isSpecialProject;

  return {
    id,
    name,
    canEdit,
    ops,
    openShare,
    handleCopyLink,
    showShare,
    createTools,
    CreateDialog,
    actions: { chat, share },
  };
}
