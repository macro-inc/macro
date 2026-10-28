import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  blockName: 'md',
  data: vi.fn<() => object | undefined>(),
  error: vi.fn<() => string | null>(),
  retry: vi.fn(),
}));
vi.mock('@core/block', () => ({
  NonDocumentBlockTypes: ['chat'],
  useBlockId: () => 'private-document',
  useBlockName: () => state.blockName,
}));
vi.mock('@core/internal/BlockLoader', () => ({
  blockDataSignal: { get: () => state.data() },
}));
vi.mock('@core/signal/load', () => ({
  blockErrorSignal: { get: () => state.error() },
  blockLoadRetrySignal: { set: (update: unknown) => state.retry(update) },
}));
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => 'online',
}));
vi.mock('@core/component/BlockContainer', () => ({
  BlockContainer: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('./AccessErrorViews/Unauthorized', () => ({
  default: () => <div>No access</div>,
}));
vi.mock('./AccessErrorViews/NotFound', () => ({ default: () => null }));
vi.mock('./AccessErrorViews/Gone', () => ({ default: () => null }));
vi.mock('./EntityLoadGate', () => ({ LoadErrorPanel: () => null }));
vi.mock('./LoadingSpinner', () => ({ LoadingPanel: () => null }));
vi.mock('@app/features/access-requests/access-requests', () => ({
  DocumentAccessDenied: (props: {
    documentId: string;
    onAccessGranted: () => void;
  }) => (
    <button data-document-id={props.documentId} onClick={props.onAccessGranted}>
      Request access
    </button>
  ),
}));

import { DocumentBlockContainer } from './DocumentBlockContainer';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('offers access requests on the full-page document route and retries after a grant', () => {
  state.blockName = 'md';
  const [data, setData] = createSignal<object>();
  const [error, setError] = createSignal<string | null>('UNAUTHORIZED');
  const [retry, setRetry] = createSignal<number>();
  state.data.mockImplementation(data);
  state.error.mockImplementation(error);
  state.retry.mockImplementation(setRetry);
  const view = render(() => (
    <DocumentBlockContainer>
      <div>Document content</div>
    </DocumentBlockContainer>
  ));
  const request = view.getByRole('button', { name: 'Request access' });
  expect(request.dataset.documentId).toBe('private-document');
  fireEvent.click(request);
  expect(retry()).toBe(1);
  setData({});
  setError(null);
  expect(view.getByText('Document content')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request access' })).toBeNull();
});

it('keeps non-document access errors separate from document requests', () => {
  state.blockName = 'chat';
  state.error.mockReturnValue('UNAUTHORIZED');
  const view = render(() => (
    <DocumentBlockContainer>
      <div>Chat content</div>
    </DocumentBlockContainer>
  ));
  expect(view.getByText('No access')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Request access' })).toBeNull();
});
