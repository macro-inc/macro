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
import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import {
  REFERENCES_DRAWER_ID,
  ReferencesButton,
} from '@core/component/ReferencesModal';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import IconShared from '@icon/wide-share.svg';
import Info from '@phosphor/info.svg';
import Notepad from '@phosphor/notepad.svg';
import Quotes from '@phosphor/quotes.svg';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const blockId = useBlockId();

  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const chatName = () => name();

  const openInstructions = useOpenInstructionsMd();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const ops: FileOperation[] = [
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
    { op: 'rename', divideAbove: true },
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
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
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
