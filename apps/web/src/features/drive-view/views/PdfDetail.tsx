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
import { useHasModificationData } from '@block-pdf/signal/save';
import { useHasComments } from '@block-pdf/store/comments/commentStore';
import {
  downloadDocxDocument,
  downloadPdfDocument,
  printPdfDocument,
} from '@block-pdf/util/pdf-file-actions';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useIsAuthenticated } from '@core/auth';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import DownloadIcon from '@phosphor/download-simple.svg';
import Printer from '@phosphor/printer.svg';
import { useSearchParams } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { loadPdfDocument, type PdfDocumentData } from '../queries/pdf-document';
import type { FileDetailContext } from '../util/file-detail-context';

export type PdfDetailContext = FileDetailContext<PdfDocumentData>;

function PdfDetailContent(props: {
  data: PdfDocumentData;
  children?: (context: PdfDetailContext) => JSX.Element;
}) {
  const isAuth = useIsAuthenticated();
  const pdf = usePdfDocument();
  const hasModificationData = useHasModificationData();
  const hasComments = useHasComments();
  const fileName =
    props.data.documentMetadata.documentName ?? 'Unknown Filename';
  const auth = () => ({
    isAuthenticated: !!isAuth(),
    openLogin: openLoginModal,
  });
  const operations: FileOperation[] = [
    {
      label: 'Print',
      icon: Printer,
      action: () => {
        void printPdfDocument({
          ...auth(),
          documentProxy: pdf.documentProxy(),
        });
      },
    },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadIcon,
      action: () => {
        void downloadPdfDocument({
          ...auth(),
          documentProxy: pdf.documentProxy(),
          hasModifications: hasModificationData(),
          hasComments: hasComments(),
          documentId: pdf.documentId(),
          fileName,
        });
      },
    },
    ...(props.data.documentMetadata.fileType === 'docx'
      ? [
          {
            group: 'file' as const,
            label: 'Download DOCX',
            icon: DownloadIcon,
            action: () => {
              void downloadDocxDocument({
                ...auth(),
                documentId: pdf.documentId(),
                fileName,
              });
            },
          },
        ]
      : []),
  ];

  return (
    <>
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <Show when={pdf.documentProxy()}>
        <div class="flex min-h-11 shrink-0 items-center gap-2 border-edge-muted border-b px-2">
          <PdfToolbarControls />
          <div class="ml-auto">
            <PdfTabsToggle />
          </div>
        </div>
      </Show>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={pdf.tabs.isVisible()}>
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
      <PdfDocument
        documentId={props.documentId}
        documentVersionId={props.data.documentMetadata.documentVersionId}
        documentName={
          props.data.documentMetadata.documentName ?? 'Unknown Filename'
        }
        documentProxy={props.data.documentProxy}
        viewLocation={props.data.viewLocation}
        modificationData={props.data.documentMetadata.modificationData}
        portalScope="split"
        permissions={{
          canComment: hasPermissions(permissions(), Permissions.CAN_COMMENT),
          canEdit: hasPermissions(permissions(), Permissions.CAN_EDIT),
          isOwner: props.data.userAccessLevel === 'owner',
        }}
        locationParams={getLocationParams(searchParams)}
      >
        <PdfDetailContent data={props.data} children={props.children} />
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
