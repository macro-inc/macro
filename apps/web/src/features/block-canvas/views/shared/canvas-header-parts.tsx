import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import type { CanvasDocumentChrome } from '../../component/CanvasDocument';
import { URL_PARAMS } from '../../constants';

/**
 * The canvas block's title menu operations and named header actions. Share
 * waits for the canvas file to load.
 */
export function useCanvasHeaderTools(state: CanvasDocumentChrome) {
  const analytics = useAnalytics();

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

  const downloadDocument = createCallback(async () => {
    const file = state.savedFile() ?? canvasFile();
    if (!file) return;

    fireAndForget(downloadFile(file, downloadName()), 'canvas-top-bar');
    analytics.track('download', { blockType: 'canvas' });
  });

  const copyLink = () => {
    const location = state.location();
    const params = {
      [URL_PARAMS.x]: location.x.toString(),
      [URL_PARAMS.y]: location.y.toString(),
      [URL_PARAMS.s]: location.s.toString(),
    };
    fireAndForget(
      copyEntityLink(
        buildSimpleEntityUrl({ type: 'canvas', id: documentId }, params)
      ),
      'canvas-top-bar'
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

  const askMacro: BlockTool = {
    label: 'Ask Macro',
    icon: ChatWithAgentIcon,
    action: () =>
      openChatWithAgent({
        type: 'document',
        id: documentId,
        name: fileName(),
        fileType: 'canvas',
      }),
  };

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    condition: () => !!canvasFile(),
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, openShare, copyLink, actions: { askMacro, share } };
}
