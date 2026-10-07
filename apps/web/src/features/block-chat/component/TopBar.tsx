import { DEFAULT_CHAT_NAME } from '@block-chat/core/types';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { useChatInputContext } from '@core/component/AI/context';
import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { Permissions } from '@core/component/SharePermissions';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { createRenameDssEntityMutation } from '@entity';
import IconShared from '@icon/share.svg';
import ChatDebugIcon from '@phosphor/chat-text.svg';
import Notepad from '@phosphor/notepad.svg';
import type { Accessor } from 'solid-js';

export function TopBar(props: {
  chatId: string;
  name: Accessor<string>;
  permissions: Accessor<Permissions>;
  owner: string;
  scopeId: string;
  showStreamDebug?: Accessor<boolean>;
  toggleStreamDebug?: () => void;
}) {
  const blockId = props.chatId;
  const input = useChatInputContext();

  const name = props.name;
  const rename = createRenameDssEntityMutation();

  const openInstructions = useOpenInstructionsMd();

  const permissions = props.permissions;
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'chat',
    itemType: 'chat',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: props.owner,
  }));

  const ops: FileOperation[] = [
    {
      label: 'Edit AI Instructions',
      icon: Notepad,
      action: openInstructions,
    },
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
    { op: 'copy' },
    { op: 'moveToProject' },
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      buttonComponent: () => (
        <ShareTrigger
          onClick={openShare}
          id={blockId}
          blockType="chat"
          hotkeyScope={props.scopeId}
        />
      ),
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={name() || DEFAULT_CHAT_NAME}
          icon={<ProviderIcon model={input.model()} class="size-4 shrink-0" />}
          onRename={
            permissions() === Permissions.OWNER
              ? (newName) =>
                  rename.mutate({
                    entity: {
                      type: 'chat',
                      id: blockId,
                      name: name(),
                      ownerId: props.owner,
                    },
                    newName,
                  })
              : undefined
          }
        />
      </SplitHeaderLeft>
      <ResponsiveBlockToolbar
        entityKind="chat"
        permissions={permissions()}
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="chat"
        name={name()}
      />
    </>
  );
}
