import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PdfDocumentContextValue,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import {
  type PdfViewerContextValue,
  PdfViewerProvider,
  usePdfViewer,
} from '../context/pdf-viewer-context';
import type { PDFViewer } from '../PdfViewer';
import { createEventBus, type TEvents } from '../PdfViewer/EventBus';
import { useCreateTab, useNavigateToTab } from './tab';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: () => ({ data: [] }),
  useMessageActions: () => ({}),
}));

afterEach(cleanup);

type TabTestApi = {
  context: PdfDocumentContextValue;
  viewer: PdfViewerContextValue;
  createTab: ReturnType<typeof useCreateTab>;
  navigateToTab: ReturnType<typeof useNavigateToTab>;
};

function Probe(props: { capture: (api: TabTestApi) => void }) {
  props.capture({
    context: usePdfDocument(),
    viewer: usePdfViewer(),
    createTab: useCreateTab(),
    navigateToTab: useNavigateToTab(),
  });
  return null;
}

function setup(isNested = false): TabTestApi {
  let api!: TabTestApi;
  render(() => (
    <PdfDocumentProvider
      documentId="document-1"
      documentName="document-1.pdf"
      isNested={isNested}
      permissions={{
        canComment: true,
        canEdit: true,
        isOwner: true,
      }}
    >
      <PdfViewerProvider>
        <Probe capture={(value) => (api = value)} />
      </PdfViewerProvider>
    </PdfDocumentProvider>
  ));
  return api;
}

function createViewer(overrides: Partial<PDFViewer> = {}) {
  return {
    event: createEventBus(),
    ...overrides,
  } as PDFViewer;
}

function setCurrentPage(viewer: PDFViewer, pageNumber: number) {
  viewer.event.dispatch('pagechanging', {
    source: {},
    pageNumber,
    previous: pageNumber - 1,
    pageLabel: null,
  } satisfies TEvents['pagechanging']);
}

describe('PDF tab hooks', () => {
  it('does not create tabs without a viewer or for nested documents', () => {
    const withoutViewer = setup();
    withoutViewer.createTab();

    const nested = setup(true);
    nested.viewer.installPair({
      root: createViewer(),
      popup: createViewer(),
    });
    nested.createTab();

    expect({
      withoutViewerCount: withoutViewer.context.tabs.count(),
      withoutViewerVisible: withoutViewer.context.tabs.isVisible(),
      nestedCount: nested.context.tabs.count(),
      nestedVisible: nested.context.tabs.isVisible(),
    }).toEqual({
      withoutViewerCount: 1,
      withoutViewerVisible: false,
      nestedCount: 1,
      nestedVisible: false,
    });
  });

  it('creates and navigates tabs through viewer state', () => {
    const { context, viewer, createTab, navigateToTab } = setup();
    const getLocationHash = vi.fn(() => '#page=3');
    const goToLocationHash = vi.fn();
    const rootViewer = createViewer({
      getLocationHash,
      goToLocationHash,
    });
    viewer.installPair({
      root: rootViewer,
      popup: createViewer(),
    });
    setCurrentPage(rootViewer, 3);

    createTab();
    createTab({ label: 'Saved location', locationHash: '#page=8' });

    expect(context.tabs.items).toEqual([
      { id: 0, label: 'Page 3', locationHash: '#page=3' },
      { id: 1, label: 'Page 3', locationHash: '#page=3' },
      { id: 2, label: 'Saved location', locationHash: '#page=8' },
    ]);
    expect(context.tabs.activeId()).toBe(2);
    expect(goToLocationHash.mock.calls).toEqual([['#page=3'], ['#page=8']]);

    getLocationHash.mockReturnValue('#page=4');
    setCurrentPage(rootViewer, 4);
    navigateToTab(0);

    expect(context.tabs.items[2]).toEqual({
      id: 2,
      label: 'Page 4',
      locationHash: '#page=4',
    });
    expect(context.tabs.activeId()).toBe(0);
    expect(goToLocationHash).toHaveBeenLastCalledWith('#page=3');
  });
});
