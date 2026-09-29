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
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
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

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'canvas',
    itemType: 'document',
    name: fileName() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  const copyEntityLink = useCopyLink();

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
    copyEntityLink(
      buildSimpleEntityUrl({ type: 'canvas', id: documentId }, params)
    );
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
      action: openShare,
      condition: () => !!canvasFile(),
      buttonComponent: () => (
        <ShareTrigger onClick={openShare} copyLink={copyLink} />
      ),
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
