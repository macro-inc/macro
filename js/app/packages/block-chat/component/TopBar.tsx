import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { useBlockId } from '@core/block';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { ReferencesButton } from '@core/component/ReferencesModal';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import Notepad from '@icon/regular/notepad.svg';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';

export function TopBar() {
  const blockId = useBlockId();

  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const chatName = () => name();

  const openInstructions = useOpenInstructionsMd();

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    { op: 'delete', divideAbove: true },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          fallbackName={DEFAULT_CHAT_NAME}
          lockRename={false}
        />
      </SplitHeaderLeft>
      <SplitToolbarLeft>
        <div class="p-1">
          <SplitFileMenu
            id={blockId}
            itemType="chat"
            name={chatName()}
            ops={ops}
          />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <DeprecatedIconButton
          icon={Notepad}
          size="sm"
          theme="clear"
          tooltip={{ label: 'Edit AI Instructions' }}
          onClick={openInstructions}
        />
        <ReferencesButton
          documentId={blockId}
          documentName={chatName()}
          buttonSize="sm"
          entityType="chat"
        />
        <div class="flex items-center">
          <SplitPermissionsBadge />
          <ShareTrigger />
        </div>
      </SplitToolbarRight>
    </>
  );
}
