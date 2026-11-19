import { afterEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('./trackBlockOpened', () => ({ track }));
vi.mock('@queries/client', () => ({ useQueryClient: () => undefined }));

import { trackOpen } from './track-open';

afterEach(() => {
  track.mockReset();
});

it('records an open for a signed-in user', async () => {
  const recorded = Promise.withResolvers<void>();
  track.mockImplementation(() => recorded.resolve());
  trackOpen('doc-1', 'pdf', () => true);
  await recorded.promise;
  expect(track).toHaveBeenCalledExactlyOnceWith({
    itemId: 'doc-1',
    blockName: 'pdf',
    client: expect.any(Function),
  });
});

it('records nothing while signed out', async () => {
  const checked = Promise.withResolvers<void>();
  trackOpen('doc-1', 'md', () => {
    checked.resolve();
    return false;
  });
  await checked.promise;
  await Promise.resolve();
  expect(track).not.toHaveBeenCalled();
});
