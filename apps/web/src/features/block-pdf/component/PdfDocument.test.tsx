import { Telemetry } from '@macro-inc/observability';
import type { BeforeLeaveEventArgs } from '@solidjs/router';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocationBlockParams } from '../signal/location';
import { PdfDocument, type PdfDocumentMethods } from './PdfDocument';

const state = vi.hoisted(() => ({
  ready: (): boolean => false,
  visible: (): boolean => false,
  nested: true,
  navigate: vi.fn(),
  initial: vi.fn(),
  clearOverlays: vi.fn(),
  save: vi.fn(),
  beforeLeave: undefined as ((event: BeforeLeaveEventArgs) => void) | undefined,
}));

vi.mock('@solidjs/router', () => ({
  useBeforeLeave: (handler: (event: BeforeLeaveEventArgs) => void) => {
    state.beforeLeave = handler;
  },
}));
vi.mock('@macro/tauri', () => ({ useTauri: () => undefined }));
vi.mock('../context/pdf-document-context', () => ({
  PdfDocumentProvider: (props: { children: JSX.Element }) => props.children,
  usePdfDocument: () => ({
    isNested: () => state.nested,
    documentVersionId: () => undefined,
    setPersistedViewLocation: () => {},
    locationParams: () => ({ pageNumber: '3', yPos: '0' }),
    persistence: { isSaving: () => false },
  }),
}));
vi.mock('../context/pdf-viewer-context', () => ({
  PdfViewerProvider: (props: { children: JSX.Element }) => props.children,
  usePdfViewer: () => ({
    root: {
      isReady: () => state.ready(),
      hasVisiblePages: () => state.visible(),
      instance: () => ({ clearAllOverlays: state.clearOverlays }),
    },
    setRootElement: () => {},
  }),
}));
vi.mock('../context/pdf-comments-context', () => ({
  PdfCommentsProvider: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('../signal/location', () => ({
  useGoToLinkLocation: () => state.initial,
  useGoToLinkLocationFromParams: () => state.navigate,
}));
vi.mock('../signal/save', () => ({ usePdfSave: () => state.save }));
vi.mock('../signal/setting', () => ({ useUpdateColorsEffect: () => {} }));
vi.mock('../store/comments/commentStore', () => ({
  usePdfCommentProjection: () => ({}),
}));
vi.mock('../store/placeables', () => ({
  useSyncActivePlaceableWithCommentThread: () => {},
}));
vi.mock('../websocket/preprocess', () => ({ preprocess: vi.fn() }));
vi.mock('./Document', () => ({ Document: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.nested = true;
  state.beforeLeave = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(initialTarget?: LocationBlockParams, initiallyReady = false) {
  const [target, setTarget] = createSignal(initialTarget);
  const [ready, setReady] = createSignal(initiallyReady);
  const [visible, setVisible] = createSignal(false);
  state.ready = ready;
  state.visible = visible;
  let methods!: Partial<PdfDocumentMethods>;
  render(() => (
    <PdfDocument
      documentId="document"
      documentName="PDF"
      permissions={{ canComment: false, canEdit: false, isOwner: false }}
      navigationTarget={target()}
      registerMethods={(value) => (methods = value)}
    >
      {null}
    </PdfDocument>
  ));
  return { setTarget, setReady, setVisible, methods };
}

it.each([false, true])(
  'discards a cleared route target while waiting for the viewer (ready=%s)',
  (ready) => {
    const test = setup({ pdf_search_page: '7' }, ready);
    test.setTarget(undefined);
    test.setReady(true);
    test.setVisible(true);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.clearOverlays).not.toHaveBeenCalled();
    expect(state.initial).toHaveBeenCalledExactlyOnceWith({
      pageNumber: '3',
      yPos: '0',
    });

    test.setTarget({ pdf_search_page: '8' });
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      pdf_search_page: '8',
    });
    test.setTarget({ pdf_search_page: '8' });
    expect(state.navigate).toHaveBeenCalledTimes(2);
  }
);

it('preserves a newer imperative location when the route target clears', async () => {
  const test = setup({ pdf_search_page: '7' });
  const mention = { pdf_page_number: '4', pdf_page_y: '0.5' };
  await test.methods.goToLocationFromParams?.(mention);
  test.setTarget(undefined);
  test.setReady(true);
  test.setVisible(true);
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith(mention);
  expect(state.initial).not.toHaveBeenCalled();

  test.setVisible(false);
  test.setTarget({ pdf_search_page: '8' });
  test.setTarget(undefined);
  test.setVisible(true);
  expect(state.navigate).toHaveBeenCalledTimes(1);
  expect(state.initial).not.toHaveBeenCalled();
});

it('does not restore the initial location after a target has been applied', () => {
  const test = setup({ pdf_search_page: '7' }, true);
  test.setVisible(true);
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    pdf_search_page: '7',
  });
  test.setTarget(undefined);
  test.setVisible(false);
  test.setTarget({ pdf_search_page: '8' });
  test.setTarget(undefined);
  test.setVisible(true);
  expect(state.navigate).toHaveBeenCalledTimes(1);
  expect(state.initial).not.toHaveBeenCalled();
});

it('keeps legacy initial-location navigation when there is no route target', () => {
  const test = setup();
  test.setReady(true);
  expect(state.initial).toHaveBeenCalledExactlyOnceWith({
    pageNumber: '3',
    yPos: '0',
  });
  expect(state.navigate).not.toHaveBeenCalled();
});

it('reports a location navigation that fails', async () => {
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const failure = new Error('viewer gone');
  state.initial.mockRejectedValueOnce(failure);
  const test = setup();
  test.setReady(true);
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith(failure, { surface: 'pdf-location' })
  );
});

it('still leaves the page when the save before leaving fails', async () => {
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const failure = new Error('offline');
  state.nested = false;
  state.save.mockRejectedValueOnce(failure);
  setup();
  const event = {
    preventDefault: vi.fn(),
    retry: vi.fn(),
  } as unknown as BeforeLeaveEventArgs;
  state.beforeLeave?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(event.retry).toHaveBeenCalledWith(true));
  expect(report).toHaveBeenCalledWith(failure, { surface: 'pdf-save' });
});
