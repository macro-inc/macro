import { ThrownResultError } from '@core/util/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewItem } from '../types';

const fetchPreviewBatch = vi.fn();

vi.mock('../fetchers', () => ({
  fetchRestPreviewBatch: (...args: unknown[]) => fetchPreviewBatch(...args),
}));

vi.mock('@service-storage/client', () => ({
  DEFAULT_ITEM_TYPE: 'document',
}));

import { previewDataLoader } from '../dataloader';

const CONTACT = '019a0000-0000-7000-8000-000000000011';
const UNAVAILABLE = [{ code: 'HTTP_ERROR', message: 'unavailable' }];

const contact: PreviewItem = {
  id: CONTACT,
  type: 'crm_contact',
  loading: false,
  access: 'access',
  rawName: 'Alex Morgan',
  name: 'Alex Morgan',
};

describe('previewDataLoader', () => {
  beforeEach(() => {
    fetchPreviewBatch.mockReset();
  });

  it('resolves items missing from the batch result as no_access, not does_not_exist', async () => {
    fetchPreviewBatch.mockResolvedValue({
      previews: new Map(),
      failed: new Map(),
    });

    const preview = await previewDataLoader.load({
      id: 'thread-1',
      type: 'email',
    });

    expect(preview).toEqual({
      id: 'thread-1',
      type: 'email',
      loading: false,
      access: 'no_access',
    });
  });

  it('resolves items present in the batch result with the fetched preview', async () => {
    const fetched: PreviewItem = {
      id: 'doc-1',
      type: 'document',
      loading: false,
      access: 'does_not_exist',
    };
    fetchPreviewBatch.mockResolvedValue({
      previews: new Map([['doc-1', fetched]]),
      failed: new Map(),
    });

    const preview = await previewDataLoader.load({
      id: 'doc-1',
      type: 'document',
    });

    expect(preview).toEqual(fetched);
  });

  it('rejects only the items whose request failed, with its error codes', async () => {
    const fetched: PreviewItem = {
      id: 'doc-1',
      type: 'document',
      loading: false,
      access: 'does_not_exist',
    };
    fetchPreviewBatch.mockResolvedValue({
      previews: new Map([['doc-1', fetched]]),
      failed: new Map([[CONTACT, UNAVAILABLE]]),
    });

    const [failed, document] = await Promise.allSettled([
      previewDataLoader.load({ id: CONTACT, type: 'crm_contact' }),
      previewDataLoader.load({ id: 'doc-1', type: 'document' }),
    ]);

    expect(fetchPreviewBatch).toHaveBeenCalledOnce();
    expect(failed.status).toBe('rejected');
    const reason = failed.status === 'rejected' ? failed.reason : undefined;
    expect(reason).toBeInstanceOf(ThrownResultError);
    expect((reason as ThrownResultError).errors).toEqual(UNAVAILABLE);
    expect(document).toEqual({ status: 'fulfilled', value: fetched });
  });

  it('asks again for an item after its request failed', async () => {
    fetchPreviewBatch
      .mockResolvedValueOnce({
        previews: new Map(),
        failed: new Map([[CONTACT, UNAVAILABLE]]),
      })
      .mockResolvedValueOnce({
        previews: new Map([[CONTACT, contact]]),
        failed: new Map(),
      });

    await expect(
      previewDataLoader.load({ id: CONTACT, type: 'crm_contact' })
    ).rejects.toBeInstanceOf(ThrownResultError);
    expect(
      await previewDataLoader.load({ id: CONTACT, type: 'crm_contact' })
    ).toEqual(contact);
    expect(fetchPreviewBatch).toHaveBeenCalledTimes(2);
  });
});
