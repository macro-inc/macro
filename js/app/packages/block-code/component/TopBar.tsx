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
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import { DocumentPropertiesModal } from '@core/component/DocumentPropertiesModal';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { ENABLE_PROPERTIES_METADATA } from '@core/constant/featureFlags';
import { blockMetadataSignal, blockTextSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { type Component, Show } from 'solid-js';

const { track, TrackingEvents } = withAnalytics();

export const TopBar: Component = () => {
  const blockId = useBlockId();
  const text = blockTextSignal.get;
  const name = useBlockDocumentName();
  const userPermissions = useGetPermissions();

  const downloadDocument = createCallback(() => {
    const filename = name();
    const content = text();
    if (!text || !name) return;
    const file = new Blob([content ?? ''], { type: 'text/plain' });
    downloadFile(file, filename);
    track(TrackingEvents.BLOCKCODE.FILEMENU.DOWNLOAD);
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
          <Show when={ENABLE_PROPERTIES_METADATA}>
            <DocumentPropertiesModal
              documentId={blockId}
              blockType="code"
              buttonSize="sm"
            />
          </Show>
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
};
