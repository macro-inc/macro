import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import Notepad from '@icon/regular/notepad.svg';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';

const FALLBACK_NAME = 'New Chat';

export function TopBar() {
  const blockId = useBlockId();

  const name = useBlockDocumentName();
  const chatName = () => name() ?? FALLBACK_NAME;

  const userPermissions = useGetPermissions();
  const openInstructions = useOpenInstructionsMd();

  const ops: FileOperation[] = [
    { op: 'pin' },
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    { op: 'delete', divideAbove: true },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={FALLBACK_NAME} lockRename={false} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="flex h-full">
          <EntityNavigationIndicator />
        </div>
      </SplitHeaderRight>
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
        <div class="flex items-center p-1 h-full">
          <IconButton
            icon={Notepad}
            size="sm"
            theme="clear"
            tooltip={{ label: 'Edit AI Instructions' }}
            onClick={openInstructions}
          />
          <ReferencesModal
            documentId={blockId}
            documentName={chatName()}
            buttonSize="sm"
          />
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <ShareButton
              id={blockId}
              name={chatName()}
              userPermissions={userPermissions()}
              itemType="chat"
            />
          </div>
        </div>
      </SplitToolbarRight>
    </>
  );
}
