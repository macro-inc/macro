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
import { DocumentPropertiesButton } from '@core/component/DocumentPropertiesModal';
import { ReferencesButton } from '@core/component/ReferencesModal';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { blockTextSignal } from '@core/signal/load';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { Component } from 'solid-js';

const { track, TrackingEvents } = withAnalytics();

export const TopBar: Component = () => {
  const blockId = useBlockId();
  const text = blockTextSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const downloadDocument = createCallback(() => {
    const content = text();
    if (!text || !name) return;
    const file = new Blob([content ?? ''], { type: 'text/plain' });
    downloadFile(file, downloadName());
    track(TrackingEvents.BLOCKCODE.FILEMENU.DOWNLOAD);
  });

  const ops: FileOperation[] = [
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
        <ReferencesButton
          documentId={blockId}
          documentName={name()}
          buttonSize="sm"
        />
        <DocumentPropertiesButton buttonSize="sm" />
        <div class="flex items-center">
          <SplitPermissionsBadge />
          <ShareTrigger />
        </div>
      </SplitToolbarRight>
    </>
  );
};
