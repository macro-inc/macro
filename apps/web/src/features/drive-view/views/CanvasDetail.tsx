import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { CanvasDocument } from '@block-canvas/component/CanvasDocument';
import { useCanvasDocument } from '@block-canvas/context/canvas-document-context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { downloadFile } from '@filesystem/download';
import { useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import {
  type CanvasDocumentData,
  loadCanvasDocument,
} from '../queries/canvas-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type CanvasDetailContext = FileDetailContext<CanvasDocumentData>;

function CanvasDetailContent(props: {
  data: CanvasDocumentData;
  children?: (context: CanvasDetailContext) => JSX.Element;
  content: JSX.Element;
}) {
  const analytics = useAnalytics();
  const [savedFile] = useCanvasDocument().state.signals.currentSavedFile;
  const downloadName = documentDownloadName(
    props.data.documentMetadata,
    'Unknown Filename'
  );
  const operations = [
    downloadFileOperation(() => {
      downloadFile(savedFile() ?? props.data.file, downloadName);
      analytics.track('download', { blockType: 'canvas' });
    }),
  ];

  return (
    <>
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        {props.content}
      </div>
    </>
  );
}

export function CanvasDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: CanvasDocumentData;
    children?: (context: CanvasDetailContext) => JSX.Element;
  }
) {
  const panel = useSplitPanelOrThrow();
  const [searchParams] = useSearchParams();
  const canEdit = () =>
    hasPermissions(
      getPermissions(props.data.userAccessLevel),
      Permissions.CAN_EDIT
    );

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="canvas"
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      <CanvasDocument
        documentId={props.documentId}
        file={props.data.file}
        canEdit={canEdit()}
        hotkeyScope={panel.splitHotkeyScope}
        portalScope="split"
        locationParams={searchParams}
      >
        {(content) => (
          <CanvasDetailContent
            data={props.data}
            children={props.children}
            content={content}
          />
        )}
      </CanvasDocument>
    </FileDetailLayout>
  );
}

export function CanvasDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: CanvasDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="canvas"
      load={loadCanvasDocument}
    >
      {(data) => (
        <CanvasDetailDocument
          documentId={props.documentId}
          data={data}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
