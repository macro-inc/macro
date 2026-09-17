import {
  PdfDocument,
  PdfDocumentContent,
} from '@block-pdf/component/PdfDocument';
import {
  PdfTabsToggle,
  PdfToolbarControls,
} from '@block-pdf/component/PdfSplitToolbar';
import { Tabs } from '@block-pdf/component/Tabs';
import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import {
  type LocationSearchParams,
  URL_PARAMS,
} from '@block-pdf/signal/location';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { loadPdfDocument, type PdfDocumentData } from '../queries/pdf-document';

export type PdfDetailContext = {
  data: PdfDocumentData;
};

function PdfDetailContent() {
  const pdf = usePdfDocument();
  const [documentProxy] = pdf.state.signals.documentProxy;
  const [showTabBar] = pdf.state.signals.showTabBar;

  return (
    <>
      <Show when={documentProxy()}>
        <div class="flex min-h-11 shrink-0 items-center gap-2 border-edge-muted border-b px-2">
          <PdfToolbarControls />
          <div class="ml-auto">
            <PdfTabsToggle />
          </div>
        </div>
      </Show>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={showTabBar()}>
          <div class="flex min-h-11 items-center justify-between gap-2 px-2">
            <div class="customScrollbar w-0 grow overflow-x-auto overflow-y-hidden">
              <Tabs />
            </div>
          </div>
        </Show>
        <PdfDocumentContent />
      </div>
    </>
  );
}

export function PdfDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: PdfDocumentData;
    children?: (context: PdfDetailContext) => JSX.Element;
  }
) {
  const panel = useSplitPanelOrThrow();
  const [searchParams] = useSearchParams();
  const permissions = () => getPermissions(props.data.userAccessLevel);

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="pdf"
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      {props.children?.({ data: props.data })}
      <PdfDocument
        documentId={props.documentId}
        documentVersionId={props.data.documentMetadata.documentVersionId}
        documentName={
          props.data.documentMetadata.documentName ?? 'Unknown Filename'
        }
        documentProxy={props.data.documentProxy}
        viewLocation={props.data.viewLocation}
        modificationData={props.data.documentMetadata.modificationData}
        hotkeyScope={panel.splitHotkeyScope}
        portalScope="split"
        permissions={{
          canComment: hasPermissions(permissions(), Permissions.CAN_COMMENT),
          canEdit: hasPermissions(permissions(), Permissions.CAN_EDIT),
          isOwner: props.data.userAccessLevel === 'owner',
        }}
        locationParams={getLocationParams(searchParams)}
      >
        <PdfDetailContent />
      </PdfDocument>
    </FileDetailLayout>
  );
}

export function PdfDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: PdfDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="PDF"
      load={loadPdfDocument}
    >
      {(data) => (
        <PdfDetailDocument
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

function getLocationParams(
  params: Partial<Record<string, string | string[] | undefined>>
): LocationSearchParams {
  const value = (key: string) => {
    const param = params[key];
    return Array.isArray(param) ? param[0] : param;
  };
  return {
    annotationId: value(URL_PARAMS.annotationId),
    searchPage: value(URL_PARAMS.searchPage),
    searchSnippet: value(URL_PARAMS.searchSnippet),
    searchRawQuery: value(URL_PARAMS.searchRawQuery),
    highlightTerms: value(URL_PARAMS.searchHighlightTerms),
    pageNumber: value(URL_PARAMS.pageNumber),
    yPos: value(URL_PARAMS.yPos),
    x: value(URL_PARAMS.x),
    width: value(URL_PARAMS.width),
    height: value(URL_PARAMS.height),
  };
}
