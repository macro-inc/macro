import { afterEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('./trackBlockOpened', () => ({ track }));
vi.mock('@queries/client', () => ({ useQueryClient: () => undefined }));

import { trackOpen } from './track-open';

afterEach(() => {
  track.mockClear();
});

it('records an open for a signed-in user', async () => {
  trackOpen('doc-1', 'pdf', () => true);
  await vi.waitFor(() => expect(track).toHaveBeenCalledOnce());
  expect(track).toHaveBeenCalledWith({
    itemId: 'doc-1',
    blockName: 'pdf',
    client: expect.any(Function),
  });
});

it('records nothing while signed out', async () => {
  trackOpen('doc-1', 'md', () => false);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await vi.dynamicImportSettled();
  expect(track).not.toHaveBeenCalled();
});
