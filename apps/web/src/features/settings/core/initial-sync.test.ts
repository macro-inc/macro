import { describe, expect, it } from 'vitest';
import { isInitialSyncComplete } from './initial-sync';

describe('isInitialSyncComplete', () => {
  it('reports an up-to-date Outlook inbox as synced without a backfill job', () => {
    expect(
      isInitialSyncComplete(
        { provider: 'OUTLOOK', sync_status: 'UP_TO_DATE' },
        undefined
      )
    ).toBe(true);
  });

  it('keeps an Outlook inbox that is still importing unfinished', () => {
    expect(
      isInitialSyncComplete(
        { provider: 'OUTLOOK', sync_status: 'SYNCING' },
        undefined
      )
    ).toBe(false);
  });

  it('needs a completed backfill job before a Gmail inbox reports as synced', () => {
    const gmail = { provider: 'GMAIL', sync_status: 'UP_TO_DATE' } as const;
    expect(isInitialSyncComplete(gmail, undefined)).toBe(false);
    expect(isInitialSyncComplete(gmail, { status: 'Failed' })).toBe(false);
    expect(isInitialSyncComplete(gmail, { status: 'Complete' })).toBe(true);
  });
});
