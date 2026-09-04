/**
 * @vitest-environment jsdom
 */

import {
  BackfillJobStatus,
  SyncStatus,
} from '@service-email/generated/schemas';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { InboxSyncStatus } from './inbox-sync-status';

vi.mock('@queries/email/backfill', () => ({
  getBackfillProgress: () => undefined,
  estimateEtaSeconds: () => undefined,
  useBackfillJobsQuery: () => ({
    isSuccess: true,
    data: {
      jobs: [{ link_id: 'inbox-1', status: BackfillJobStatus.Complete }],
    },
  }),
}));

describe('InboxSyncStatus', () => {
  it('shows Initial sync complete after a finished backfill', () => {
    render(() => (
      <InboxSyncStatus
        link={
          {
            id: 'inbox-1',
            sync_status: SyncStatus.UP_TO_DATE,
          } as never
        }
      />
    ));
    expect(screen.getByText('Initial sync complete')).toBeTruthy();
  });
});
