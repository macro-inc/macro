import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { withAnalytics } from '@coparse/analytics';
import { createBlockSignal, useBlockId } from '@core/block';
import { DocumentPropertiesModal } from '@core/component/DocumentPropertiesModal';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_PROPERTIES_METADATA,
  ENABLE_REFERENCES_MODAL,
} from '@core/constant/featureFlags';
import { blockFileSignal, blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@icon/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { onMount, Show } from 'solid-js';
import { URL_PARAMS } from '../constants';
import { useToolManager } from '../signal/toolManager';
import { currentSavedFile } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';

const { track, TrackingEvents } = withAnalytics();

export const connectorTypeMenuTriggerSignal = createBlockSignal(false);

export function TopBar() {
  const toolManager = useToolManager();
  const { getLocation } = useRenderState();
  const getCurrentSavedFile = currentSavedFile.get;
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const canvasFile = blockFileSignal.get;
  const userPermissions = useGetPermissions();

  let ref!: HTMLDivElement;
  onMount(() => {
    toolManager.ignoreMouseEvents(ref);
  });

  const downloadDocument = createCallback(async () => {
    const file = getCurrentSavedFile() ?? canvasFile();
    const name = fileName();
    if (!file) return;

    downloadFile(file, `${name}.canvas`);
    track(TrackingEvents.BLOCKCANVAS.FILEMENU.DOWNLOAD);
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
    track(TrackingEvents.BLOCKCANVAS.FILEMENU.SHARE);
  };

  const ops: FileOperation[] = [
    { op: 'pin' },
    { op: 'copy' },
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

  return (
    <div ref={ref}>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
      </SplitHeaderRight>
      <SplitToolbarLeft>
        <div class="p-1">
          <SplitFileMenu
            id={documentId}
            itemType="document"
            name={fileName()}
            ops={ops}
          />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <Show when={ENABLE_REFERENCES_MODAL}>
            <ReferencesModal
              documentId={documentId}
              documentName={fileName()}
              buttonSize="sm"
            />
          </Show>
          <Show when={ENABLE_PROPERTIES_METADATA}>
            <DocumentPropertiesModal
              documentId={documentId}
              blockType="canvas"
              buttonSize="sm"
            />
          </Show>
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <Show when={canvasFile()} keyed>
              <ShareButton
                id={documentId}
                name={fileName()}
                userPermissions={userPermissions()}
                copyLink={copyLink}
                itemType="document"
                owner={blockMetadataSignal()?.owner}
              />
            </Show>
          </div>
        </div>
      </SplitToolbarRight>
    </div>
  );
}
