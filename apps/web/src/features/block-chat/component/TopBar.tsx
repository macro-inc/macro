import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';

import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import IconShared from '@icon/wide-share.svg';
import ChatDebugIcon from '@phosphor/chat-text.svg';
import Info from '@phosphor/info.svg';
import Notepad from '@phosphor/notepad.svg';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';
import type { Accessor } from 'solid-js';

export function TopBar(props: {
  showStreamDebug?: Accessor<boolean>;
  toggleStreamDebug?: () => void;
}) {
  const blockId = useBlockId();

  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const chatName = () => name();

  const openInstructions = useOpenInstructionsMd();

  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const ops: FileOperation[] = [
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
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
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          fallbackName={DEFAULT_CHAT_NAME}
          lockRename={false}
        />
      </SplitHeaderLeft>
      <ResponsivePermissionsBadge />
      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="chat"
        name={chatName()}
      />
    </>
  );
}
