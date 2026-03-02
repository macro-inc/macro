import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';

import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import {
  ReferencesButton,
  REFERENCES_DRAWER_ID,
} from '@core/component/ReferencesModal';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import Notepad from '@icon/regular/notepad.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@icon/regular/share.svg';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';

export function TopBar() {
  const blockId = useBlockId();

  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const chatName = () => name();

  const openInstructions = useOpenInstructionsMd();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    { op: 'delete', divideAbove: true },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Edit AI Instructions',
      icon: Notepad,
      action: openInstructions,
    },
    {
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      buttonComponent: () => (
        <ReferencesButton
          documentId={blockId}
          documentName={chatName()}
          buttonSize="sm"
          entityType="chat"
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
      buttonComponent: () => <ShareTrigger />,
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
