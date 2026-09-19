import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { SidePanel } from '@components/app/side-panel';
import { blockDataSignalAs, useBlockId, useIsNestedBlock } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockHandleSignal, blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useSearchParams } from '@solidjs/router';
import { Show } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import type { PdfBlockData } from '../definition';
import { type LocationSearchParams, URL_PARAMS } from '../signal/location';
import { ModalsProvider } from './ModalsProvider';
import {
  PdfDocument,
  PdfDocumentContent,
  type PdfDocumentMethods,
} from './PdfDocument';
import { PdfSidePanelSections } from './sidepanel/PdfSidePanelSections';
import { Tabs } from './Tabs';
import { TopBar } from './TopBar';

export default function BlockPdf() {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const isNested = useIsNestedBlock();
  const metadata = blockMetadataSignal.get;
  const documentName = useBlockDocumentName('Unknown Filename');
  const canComment = useCanComment();
  const canEdit = useCanEdit();
  const isOwner = useIsDocumentOwner();
  const [searchParams] = useSearchParams();
  const blockHandle = blockHandleSignal.get;
  const data = blockDataSignalAs<PdfBlockData>('pdf');

  const registerMethods = (methods: Partial<PdfDocumentMethods>) =>
    createMethodRegistration(blockHandle, methods);

  return (
    <DocumentBlockContainer>
      <PdfDocument
        documentId={documentId}
        documentVersionId={metadata()?.documentVersionId}
        documentName={documentName()}
        documentProxy={data()?.documentProxy}
        viewLocation={data()?.viewLocation}
        modificationData={data()?.documentMetadata.modificationData}
        isNested={isNested}
        hotkeyScope={blockHotkeyScopeSignal.get()}
        portalScope="block"
        permissions={{
          canComment: canComment(),
          canEdit: canEdit(),
          isOwner: isOwner(),
        }}
        locationParams={getLocationParams(searchParams)}
        registerMethods={registerMethods}
      >
        <PdfBlockContent />
      </PdfDocument>
    </DocumentBlockContainer>
  );
}

function PdfBlockContent() {
  const pdf = usePdfDocument();
  const [showTabBar] = pdf.state.signals.showTabBar;

  return (
    <ModalsProvider>
      <Show when={!pdf.isNested()} fallback={<PdfDocumentContent />}>
        <SidePanel.Layout>
          <PdfSidePanelSections />
          <div class="flex size-full min-w-0 flex-col overflow-hidden">
            <TopBar />
            <Show when={showTabBar()}>
              <div class="flex px-2 justify-between min-h-11 items-center gap-2">
                <div class="overflow-x-auto overflow-y-hidden grow customScrollbar w-0">
                  <Tabs />
                </div>
              </div>
            </Show>
            <PdfDocumentContent />
          </div>
        </SidePanel.Layout>
      </Show>
    </ModalsProvider>
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
