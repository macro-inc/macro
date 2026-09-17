import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@components/app/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import {
  getShareDrawerRecipientInput,
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
import Download from '@phosphor/download-simple.svg';
import IconShared from '@phosphor/share.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { CodeBlockMode } from './CodeContent';
import { CodeFileTypeChip } from './CodeFileTypeChip';
import { CodeModeControl } from './CodeModeControl';

export const TopBar: Component<{
  isHtmlFile: boolean;
  mode: CodeBlockMode;
  onModeChange: (mode: CodeBlockMode) => void;
}> = (props) => {
  const analytics = useAnalytics();

  const blockId = useBlockId();
  const text = blockTextSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const shareCtx = useShareDialogContext();

  const downloadDocument = createCallback(() => {
    const content = text();
    if (!text || !name) return;
    const file = new Blob([content ?? ''], { type: 'text/plain' });
    downloadFile(file, downloadName());
    analytics.track('download', { blockType: 'code' });
  });

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: Download,
      action: downloadDocument,
    },
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<CodeFileTypeChip />} />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <Show when={props.isHtmlFile && !isMobile()}>
        <SplitToolbarRight order={-1}>
          <CodeModeControl
            mode={props.mode}
            onModeChange={props.onModeChange}
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
