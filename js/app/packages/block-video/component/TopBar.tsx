import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import {
  type BlockTool,
  ToolButton,
} from '@app/component/split-layout/components/BlockTool';
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
import {
  ReferencesButton,
  REFERENCES_DRAWER_ID,
} from '@core/component/ReferencesModal';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@icon/regular/share.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { For, Show } from 'solid-js';
import { useGetFileBlob } from '../signal/blockData';

export function TopBar() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const downloadDocument = createCallback(async () => {
    try {
      const blob = await getBlob();
      downloadFile(blob, downloadName());
    } catch (e) {
      console.error('error downloading file', e);
      toast.failure('Error downloading file');
    }
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
      <SplitToolbarLeft>
        <div class="p-1">
          <SplitFileMenu
            id={blockId}
            itemType="document"
            name={name()}
            ops={ops}
            tools={isMobile() ? tools : undefined}
          />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <For each={tools}>
          {(tool) => (
            <Show when={!tool.condition || tool.condition()}>
              {tool.buttonComponent ? (
                <tool.buttonComponent />
              ) : (
                <ToolButton tool={tool} />
              )}
            </Show>
          )}
        </For>
        <SplitPermissionsBadge />
      </SplitToolbarRight>
    </>
  );
}
