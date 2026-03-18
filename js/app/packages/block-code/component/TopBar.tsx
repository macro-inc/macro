import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';

import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import {
  DocumentPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from '@core/component/DocumentPropertiesModal';
import {
  ReferencesButton,
  REFERENCES_DRAWER_ID,
} from '@core/component/ReferencesModal';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { isMobile } from '@core/mobile/isMobile';
import { blockTextSignal } from '@core/signal/load';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download-simple.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@icon/regular/share.svg';
import TagIcon from '@icon/regular/tag.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { CodeBlockMode } from './Block';
import { TabbedControl } from '@ui/components/TabbedControl';

const { track, TrackingEvents } = withAnalytics();

export const TopBar: Component<{
  isHtmlFile: boolean;
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}> = (props) => {
  const blockId = useBlockId();
  const text = blockTextSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const shareCtx = useShareDialogContext();

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

  const tools: BlockTool[] = [
    {
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      buttonComponent: () => (
        <ReferencesButton
          documentId={blockId}
          documentName={name()}
          buttonSize="sm"
        />
      ),
    },
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      buttonComponent: () => <DocumentPropertiesButton buttonSize="sm" />,
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
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <Show when={props.isHtmlFile && !isMobile()}>
        <SplitToolbarRight order={-1}>
          <TabbedControl
            list={[
              { value: 'render', label: 'Render' },
              { value: 'code', label: 'Code' },
            ]}
            value={props.mode}
            onChange={(value) => props.onModeChange(value as CodeBlockMode)}
          />
        </SplitToolbarRight>
      </Show>

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name()}
      />
    </>
  );
};
