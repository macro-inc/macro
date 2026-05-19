import { useAnalytics } from '@app/component/analytics-context';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useIsAuthenticated } from '@core/auth';
import { createBlockSignal, useBlockId } from '@core/block';
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import {
  DocumentPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from '@core/component/DocumentPropertiesModal';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  REFERENCES_DRAWER_ID,
  ReferencesButton,
} from '@core/component/ReferencesModal';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import { blockFileSignal } from '@core/signal/load';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/wide-share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import Info from '@phosphor/info.svg';
import Quotes from '@phosphor/quotes.svg';
import TagIcon from '@phosphor/tag.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { onMount } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { useToolManager } from '../signal/toolManager';
import { currentSavedFile } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';

export const connectorTypeMenuTriggerSignal = createBlockSignal(false);

export function TopBar() {
  const analytics = useAnalytics();

  const isAuth = useIsAuthenticated();

  const toolManager = useToolManager();
  const { getLocation } = useRenderState();
  const getCurrentSavedFile = currentSavedFile.get;
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const downloadName = useBlockDocumentDownloadName('Unknown Filename');
  const canvasFile = blockFileSignal.get;

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
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
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
    { op: 'copy', divideAbove: true },
    { op: 'rename' },
    { op: 'moveToProject' },
    {
      label: 'Download',
      icon: DownloadSimple,
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
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
      buttonComponent: () => (
        <ReferencesButton
          documentId={documentId}
          documentName={fileName()}
          buttonSize="sm"
        />
      ),
    },
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      buttonComponent: () => (
        <DocumentPropertiesButton
          buttonSize="sm"
          onOpenChange={(open) =>
            open &&
            analytics.track('properties_panel_open', { blockType: 'canvas' })
          }
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
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
        <div class="-order-1">
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
