import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { blockFileSignal } from '@core/signal/load';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@phosphor/download-simple.svg';
import IconShared from '@phosphor/share.svg';
import { createCallback } from '@solid-primitives/rootless';
import { onMount } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { useCanvasDocument } from '../context/canvas-document-context';
import { useToolManager } from '../signal/toolManager';
import { useRenderState } from '../store/RenderState';

export function TopBar() {
  const analytics = useAnalytics();

  const toolManager = useToolManager();
  const { getLocation } = useRenderState();
  const [getCurrentSavedFile] =
    useCanvasDocument().state.signals.currentSavedFile;
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const downloadName = useBlockDocumentDownloadName('Unknown Filename');
  const canvasFile = blockFileSignal.get;

  const shareCtx = useShareDialogContext();

  let ref!: HTMLDivElement;
  onMount(() => {
    toolManager.ignoreMouseEvents(ref);
  });

  const downloadDocument = createCallback(async () => {
    const file = getCurrentSavedFile() ?? canvasFile();
    if (!file) return;

    downloadFile(file, downloadName());
    analytics.track('download', { blockType: 'canvas' });
  });

  const copyLink = () => {
    const location = getLocation();
    const params = {
      [URL_PARAMS.x]: location.x.toString(),
      [URL_PARAMS.y]: location.y.toString(),
      [URL_PARAMS.s]: location.s.toString(),
    };
    const url = buildSimpleEntityUrl(
      {
        type: 'canvas',
        id: documentId,
      },
      params
    );
    if (!url) {
      toast.failure('failed to copy url');
      return;
    }
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
    analytics.track('copy_share_link', { blockType: 'canvas' });
  };

  const ops: FileOperation[] = [
    { op: 'copy' },
    { op: 'rename' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadSimple,
      action: downloadDocument,
    },
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: documentId,
          name: fileName(),
          fileType: 'canvas',
        }),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      condition: () => !!canvasFile(),
      buttonComponent: () => <ShareTrigger copyLink={copyLink} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <div ref={ref}>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
        <div class="-order-1 touch:hidden">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={documentId}
        itemType="document"
        name={fileName()}
      />
    </div>
  );
}
