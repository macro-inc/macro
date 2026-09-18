import { CanvasDocument } from '@block-canvas/component/CanvasDocument';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  type CanvasDocumentData,
  loadCanvasDocument,
} from '../queries/canvas-document';

export type CanvasDetailContext = {
  data: CanvasDocumentData;
};

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
      {props.children?.({ data: props.data })}
      <CanvasDocument
        documentId={props.documentId}
        file={props.data.file}
        canEdit={canEdit()}
        hotkeyScope={panel.splitHotkeyScope}
        portalScope="split"
        locationParams={searchParams}
      >
        {(content) => (
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            {content}
          </div>
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
