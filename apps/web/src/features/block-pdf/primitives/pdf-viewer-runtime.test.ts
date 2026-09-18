import type { PDFPageView } from 'pdfjs-dist/web/pdf_viewer';
import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { PDFViewer } from '../PdfViewer';
import {
  createEventBus,
  FindState,
  type IVisiblePage,
  type TEvents,
} from '../PdfViewer/EventBus';
import {
  createPdfViewerRuntime,
  type PdfViewerRuntime,
} from './pdf-viewer-runtime';

function createViewer() {
  return { event: createEventBus() } as unknown as PDFViewer;
}

function updateViewArea(pageNumber: number): TEvents['updateviewarea'] {
  const page = {
    id: pageNumber,
    x: 0,
    y: 0,
    view: {} as IVisiblePage['view'],
    percent: 100,
    widthPercent: 100,
  };
  return {
    source: {},
    location: {
      pageNumber,
      scale: 1,
      top: 0,
      left: 0,
      rotation: 0,
      pdfOpenParams: '',
      unscaledYPos: 0,
      viewportScale: 1,
    },
    visiblePages: {
      first: page,
      last: page,
      views: [page],
      ids: new Set([pageNumber]),
    },
  };
}

function overlayViews(
  pages: Array<{ id: number; height: number }>
): TEvents['overlayViewsChanged'] {
  return {
    views: pages.map(
      ({ id, height }) =>
        ({
          id,
          viewport: { height },
        }) as unknown as PDFPageView
    ),
  };
}

function setup(): {
  viewer: PdfViewerRuntime;
  snapshots: Array<{
    root: PDFViewer | undefined;
    popup: PDFViewer | undefined;
  }>;
  dispose: () => void;
} {
  return createRoot((dispose) => {
    const viewer = createPdfViewerRuntime();
    const snapshots: Array<{
      root: PDFViewer | undefined;
      popup: PDFViewer | undefined;
    }> = [];
    createComputed(() => {
      snapshots.push({
        root: viewer.root.instance(),
        popup: viewer.popup.instance(),
      });
    });
    return { viewer, snapshots, dispose };
  });
}

describe('createPdfViewerRuntime', () => {
  it('installs and clears the viewer pair atomically', () => {
    const { viewer, snapshots, dispose } = setup();
    const root = createViewer();
    const popup = createViewer();

    viewer.installPair({ root, popup });
    viewer.detachListeners();
    viewer.clearPair();

    expect(snapshots).toEqual([
      { root: undefined, popup: undefined },
      { root, popup },
      { root: undefined, popup: undefined },
    ]);
    dispose();
  });

  it('owns one shared overlay value', () => {
    const { viewer, dispose } = setup();
    const overlays = ['overlay-1', 'overlay-2'];

    expect(viewer.overlays()).toBeUndefined();
    viewer.replaceOverlays(overlays);

    expect(viewer.overlays()).toBe(overlays);
    dispose();
  });

  it('projects root and popup events into separate domain state', () => {
    const { viewer, dispose } = setup();
    const root = createViewer();
    const popup = createViewer();
    const rootOverlayViews = overlayViews([
      { id: 1, height: 720 },
      { id: 3, height: 900 },
    ]);
    const popupOverlayViews = overlayViews([{ id: 2, height: 400 }]);
    const rootViewArea = updateViewArea(3);
    const popupViewArea = updateViewArea(2);
    const findControlState = {
      source: {},
      matchesCount: { current: 1, total: 2 },
      state: FindState.FOUND,
      previous: false,
      rawQuery: 'query',
    } as TEvents['updatefindcontrolstate'];
    const findMatchesCount = {
      source: {},
      matchesCount: { current: 2, total: 2 },
    } as TEvents['updatefindmatchescount'];
    viewer.installPair({ root, popup });

    root.event.dispatch('pagesloaded', { source: {}, pagesCount: 8 });
    root.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 3,
      previous: 2,
      pageLabel: null,
    });
    root.event.dispatch('scalechanging', {
      source: {},
      scale: 1,
      presetValue: undefined,
    });
    root.event.dispatch('overlayViewsChanged', rootOverlayViews);
    root.event.dispatch('updateviewarea', rootViewArea);
    root.event.dispatch('updatefindcontrolstate', findControlState);
    root.event.dispatch('updatefindmatchescount', findMatchesCount);
    root.event.dispatch('popupvisibilitychanged', {
      source: {},
      isOpen: true,
      target: document.createElement('div'),
    });

    popup.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 2,
      previous: 1,
      pageLabel: null,
    });
    popup.event.dispatch('scalechanging', {
      source: {},
      scale: 1.5,
      presetValue: undefined,
    });
    popup.event.dispatch('overlayViewsChanged', popupOverlayViews);
    popup.event.dispatch('updateviewarea', popupViewArea);

    expect({
      rootPage: viewer.root.currentPageNumber(),
      rootScale: viewer.root.currentScale(),
      rootPageCount: viewer.root.pageCount(),
      rootReady: viewer.root.isReady(),
      rootVisible: viewer.root.hasVisiblePages(),
      canZoomIn: viewer.root.canZoomIn(),
      canZoomOut: viewer.root.canZoomOut(),
      popupPage: viewer.popup.currentPageNumber(),
      popupScale: viewer.popup.currentScale(),
      popupOpen: viewer.isPopupOpen(),
    }).toEqual({
      rootPage: 3,
      rootScale: 1,
      rootPageCount: 8,
      rootReady: true,
      rootVisible: true,
      canZoomIn: true,
      canZoomOut: true,
      popupPage: 2,
      popupScale: 1.5,
      popupOpen: true,
    });
    expect(viewer.root.overlayViews()).toBe(rootOverlayViews);
    expect(viewer.root.viewArea()).toBe(rootViewArea);
    expect(viewer.root.findControlState()).toBe(findControlState);
    expect(viewer.root.findMatchesCount()).toBe(findMatchesCount);
    expect(viewer.root.pageHeights).toEqual({ 0: 720, 2: 900 });
    expect(viewer.popup.overlayViews()).toBe(popupOverlayViews);
    expect(viewer.popup.viewArea()).toBe(popupViewArea);
    dispose();
  });

  it('detaches listeners, resets projections, and retains page heights', () => {
    const { viewer, dispose } = setup();
    const root = createViewer();
    const popup = createViewer();
    const rootOverlayViews = overlayViews([{ id: 2, height: 640 }]);
    viewer.installPair({ root, popup });
    root.event.dispatch('pagesloaded', { source: {}, pagesCount: 4 });
    root.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 2,
      previous: 1,
      pageLabel: null,
    });
    root.event.dispatch('scalechanging', {
      source: {},
      scale: 1,
      presetValue: undefined,
    });
    root.event.dispatch('overlayViewsChanged', rootOverlayViews);
    root.event.dispatch('updateviewarea', updateViewArea(2));
    root.event.dispatch('updatefindcontrolstate', {
      source: {},
      matchesCount: { current: 0, total: 0 },
      state: FindState.PENDING,
      previous: false,
      rawQuery: 'query',
    } as TEvents['updatefindcontrolstate']);
    root.event.dispatch('updatefindmatchescount', {
      source: {},
      matchesCount: { current: 0, total: 0 },
    } as TEvents['updatefindmatchescount']);
    root.event.dispatch('popupvisibilitychanged', {
      source: {},
      isOpen: true,
      target: document.createElement('div'),
    });
    popup.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 3,
      previous: 2,
      pageLabel: null,
    });
    popup.event.dispatch('scalechanging', {
      source: {},
      scale: 2,
      presetValue: undefined,
    });
    popup.event.dispatch(
      'overlayViewsChanged',
      overlayViews([{ id: 1, height: 300 }])
    );
    popup.event.dispatch('updateviewarea', updateViewArea(1));

    viewer.detachListeners();

    root.event.dispatch('pagesloaded', { source: {}, pagesCount: 99 });
    popup.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 99,
      previous: 3,
      pageLabel: null,
    });

    expect({
      rootInstance: viewer.root.instance(),
      popupInstance: viewer.popup.instance(),
      rootPage: viewer.root.currentPageNumber(),
      rootScale: viewer.root.currentScale(),
      rootPageCount: viewer.root.pageCount(),
      rootReady: viewer.root.isReady(),
      rootVisible: viewer.root.hasVisiblePages(),
      rootOverlayViews: viewer.root.overlayViews(),
      rootViewArea: viewer.root.viewArea(),
      rootFindControlState: viewer.root.findControlState(),
      rootFindMatchesCount: viewer.root.findMatchesCount(),
      popupPage: viewer.popup.currentPageNumber(),
      popupScale: viewer.popup.currentScale(),
      popupOverlayViews: viewer.popup.overlayViews(),
      popupViewArea: viewer.popup.viewArea(),
      popupOpen: viewer.isPopupOpen(),
      pageHeights: viewer.root.pageHeights,
    }).toEqual({
      rootInstance: root,
      popupInstance: popup,
      rootPage: 1,
      rootScale: undefined,
      rootPageCount: undefined,
      rootReady: false,
      rootVisible: false,
      rootOverlayViews: undefined,
      rootViewArea: undefined,
      rootFindControlState: undefined,
      rootFindMatchesCount: undefined,
      popupPage: 1,
      popupScale: undefined,
      popupOverlayViews: undefined,
      popupViewArea: undefined,
      popupOpen: false,
      pageHeights: { 1: 640 },
    });
    dispose();
  });

  it('isolates viewer runtimes', () => {
    const first = setup();
    const second = setup();
    const root = createViewer();
    const popup = createViewer();

    first.viewer.installPair({ root, popup });
    first.viewer.replaceOverlays(['overlay-1']);
    root.event.dispatch('pagesloaded', { source: {}, pagesCount: 2 });

    expect({
      firstRoot: first.viewer.root.instance(),
      firstPopup: first.viewer.popup.instance(),
      firstOverlays: first.viewer.overlays(),
      firstReady: first.viewer.root.isReady(),
      secondRoot: second.viewer.root.instance(),
      secondPopup: second.viewer.popup.instance(),
      secondOverlays: second.viewer.overlays(),
      secondReady: second.viewer.root.isReady(),
    }).toEqual({
      firstRoot: root,
      firstPopup: popup,
      firstOverlays: ['overlay-1'],
      firstReady: true,
      secondRoot: undefined,
      secondPopup: undefined,
      secondOverlays: undefined,
      secondReady: false,
    });
    first.dispose();
    second.dispose();
  });
});
