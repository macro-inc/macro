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
import { useBlockId } from '@core/block';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download.svg';
import { createCallback } from '@solid-primitives/rootless';

export function TopBar() {
  const blockId = useBlockId();
  const imageFile = blockFileSignal.get;
  const name = useBlockDocumentName();
  const userPermissions = useGetPermissions();

  const downloadDocument = createCallback(async () => {
    const file = imageFile();
    if (!file) return;
    downloadFile(file);
  });

  const ops: FileOperation[] = [
    { op: 'pin' },
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Download',
      icon: Download,
      action: downloadDocument,
      divideAbove: true,
    },
    { op: 'delete', divideAbove: true },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <SplitToolbarLeft>
        <div class="p-1">
          <SplitFileMenu
            id={blockId}
            itemType="document"
            name={name()}
            ops={ops}
          />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <ReferencesModal
            documentId={blockId}
            documentName={name()}
            buttonSize="sm"
          />
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <ShareButton
              id={blockId}
              name={name()}
              userPermissions={userPermissions()}
              itemType="document"
              owner={blockMetadataSignal()?.owner}
            />
          </div>
        </div>
      </SplitToolbarRight>
    </>
  );
}
