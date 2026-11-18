import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  locationToUrl,
  useCreateShareUrl,
  useGoToLinkLocation,
} from './location';

const originalUrl = window.location.href;

const state = vi.hoisted(() => ({
  persistedViewLocation: (): string | undefined => undefined,
  ready: (): boolean => false,
  goToLocationHash: vi.fn(),
}));

vi.mock('../context/pdf-document-context', () => ({
  usePdfDocument: () => ({
    documentId: () => 'shared-pdf',
    shareLocation: () => undefined,
    persistedViewLocation: () => state.persistedViewLocation(),
  }),
}));
vi.mock('../context/pdf-viewer-context', () => ({
  usePdfViewer: () => ({
    root: {
      currentPageNumber: () => 4,
      isReady: () => state.ready(),
      hasVisiblePages: () => state.ready(),
      instance: () => ({ goToLocationHash: state.goToLocationHash }),
      findControlState: () => undefined,
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', originalUrl);
});

function setup(persistedViewLocation?: string) {
  const [ready, setReady] = createSignal(false);
  state.persistedViewLocation = () => persistedViewLocation;
  state.ready = ready;
  const goToLinkLocation = createRoot(() => useGoToLinkLocation());
  return { goToLinkLocation, setReady };
}

it('settles without restoring when the PDF has no saved location', async () => {
  const { goToLinkLocation } = setup();
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(5000);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).not.toHaveBeenCalled();
});

it('restores the saved location once the viewer shows pages', async () => {
  const { goToLinkLocation, setReady } = setup('#page=4');
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(1000);
  setReady(true);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).toHaveBeenCalledExactlyOnceWith('#page=4');
});

it('settles without restoring when the viewer never shows pages', async () => {
  const { goToLinkLocation } = setup('#page=4');
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(5000);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).not.toHaveBeenCalled();
});

it('copies the viewed PDF without the surrounding route or split state', () => {
  window.history.replaceState(
    null,
    '',
    '/app/drive/folder/folder-1/md/other-document?s0.taskId=other-task&pdf_page_number=9#selection'
  );
  const shareUrl = createRoot(() => useCreateShareUrl());

  expect(shareUrl('general')).toBe(
    `${window.location.origin}/app/pdf/shared-pdf?pdf_page_number=4&pdf_page_y=0`
  );
});

it('keeps only the selected annotation in a PDF link', () => {
  window.history.replaceState(
    null,
    '',
    '/app/drive/pdf/other-pdf?s1.path=/app/task/other-task#selection'
  );

  expect(
    locationToUrl('shared-pdf', {
      type: 'annotation',
      pageIndex: 2,
      id: 'annotation-1',
    })
  ).toBe(
    `${window.location.origin}/app/pdf/shared-pdf?pdf_ann_id=annotation-1`
  );
});

it('preserves precise PDF coordinates rounded to three decimal places', () => {
  expect(
    locationToUrl('shared-pdf', {
      type: 'precise',
      pageIndex: 2,
      y: 0.123456,
      x: 0.234567,
      width: 0.345678,
      height: 0.456789,
    })
  ).toBe(
    `${window.location.origin}/app/pdf/shared-pdf?pdf_page_number=2&pdf_page_y=0.123&pdf_page_x=0.235&pdf_width=0.346&pdf_height=0.457`
  );
});
