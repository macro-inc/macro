import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const [authenticated, setAuthenticated] = createSignal(true);
vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => authenticated,
}));
vi.mock('@core/component/AI/constant/fileType', () => ({
  SUPPORTED_CHAT_ATTACHMENT_BLOCKS: ['md'],
}));
vi.mock('@core/util/getItemBlockName', () => ({
  getItemBlockName: () => 'md',
}));
vi.mock('@queries/history/history', () => ({
  useHistoryQuery: () => ({
    isSuccess: true,
    data: [{ id: 'private-document', name: 'Private document' }],
  }),
}));

import {
  globalAttachableHistory,
  useGlobalAttachableHistory,
} from './globalAttachments';

it('clears attachment suggestions on logout even while the history cache retains data', () => {
  const dispose = createRoot((dispose) => {
    useGlobalAttachableHistory();
    return dispose;
  });
  try {
    expect(globalAttachableHistory().map((item) => item.id)).toEqual([
      'private-document',
    ]);
    setAuthenticated(false);
    expect(globalAttachableHistory()).toEqual([]);
  } finally {
    dispose();
  }
});
