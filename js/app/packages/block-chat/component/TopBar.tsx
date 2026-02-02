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
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import Notepad from '@icon/regular/notepad.svg';
import { createCognitionWebsocketEffect } from '@service-cognition/websocket';
import { refetchHistory } from '@queries/history/history';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';
import { onCleanup, onMount } from 'solid-js';
import { setPreviewData } from '@queries/preview';

export function TopBar() {
  const blockId = useBlockId();

  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const chatName = () => name();

  onMount(() => {
    if (!name() || name() === DEFAULT_CHAT_NAME) {
      const dispose = createCognitionWebsocketEffect('chat_renamed', (data) => {
        if (data.chat_id === blockId) {
          refetchHistory();
          setPreviewData(data.chat_id, (prev) => ({
            ...prev,
            name: data.name,
          }));
          dispose();
        }
      });

      onCleanup(() => {
        dispose();
      });
    }
  });

  const userPermissions = useGetPermissions();
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
        <div class="flex items-center p-1 h-full">
          <DeprecatedIconButton
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
            entityType="chat"
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
