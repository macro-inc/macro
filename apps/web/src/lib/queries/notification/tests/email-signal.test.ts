import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEmailNotificationSignal } from '../email-signal';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems: vi.fn() },
}));

// Membership is evaluated server-side; these fixtures only need the returned ID.
function emailThread(id: string): SoupApiItem {
  return { tag: 'emailThread', data: { id } } as SoupApiItem;
}

const getSoupItems = vi.mocked(storageServiceClient.getSoupItems);

describe('checkEmailNotificationSignal', () => {
  beforeEach(() => {
    getSoupItems.mockReset();
  });

  it('uses a fresh, one-thread Signal query without including other entity types', async () => {
    getSoupItems.mockResolvedValue(ok({ items: [emailThread('thread-1')] }));

    expect(await checkEmailNotificationSignal('thread-1')).toEqual(ok(true));
    expect(getSoupItems).toHaveBeenCalledWith({
      params: {},
      body: {
        ...QUERY_FILTERS_BASE,
        limit: 1,
        emailView: 'inbox',
        email_filters: {
          email_thread_ids: ['thread-1'],
          importance: true,
          shared: 'exclude',
        },
      },
    });
  });

  it('rejects emails the server excludes from Signal', async () => {
    getSoupItems.mockResolvedValue(ok({ items: [] }));

    expect(await checkEmailNotificationSignal('thread-1')).toEqual(ok(false));
  });

  it('requires the matching email thread, not just a nonempty page', async () => {
    getSoupItems.mockResolvedValue(
      ok({ items: [emailThread('another-thread')] })
    );

    expect(await checkEmailNotificationSignal('thread-1')).toEqual(ok(false));
  });

  it('does not reuse eligibility after a sender is moved to Noise', async () => {
    getSoupItems
      .mockResolvedValueOnce(ok({ items: [emailThread('thread-1')] }))
      .mockResolvedValueOnce(ok({ items: [] }));

    expect(await checkEmailNotificationSignal('thread-1')).toEqual(ok(true));
    expect(await checkEmailNotificationSignal('thread-1')).toEqual(ok(false));
    expect(getSoupItems).toHaveBeenCalledTimes(2);
  });

  it('preserves lookup failures for the popup handler to suppress', async () => {
    const error = [{ code: 'UNKNOWN' as const, message: 'Lookup failed' }];
    getSoupItems.mockResolvedValue(err(error));

    expect(await checkEmailNotificationSignal('thread-1')).toEqual(err(error));
  });
});
