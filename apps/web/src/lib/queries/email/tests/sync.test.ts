import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from '../keys';
import { handleRefreshEmail } from '../sync';
import { onEmailThreadRefresh } from '../thread-refresh';

const invalidateQueries = vi.hoisted(() => vi.fn());
const invalidateInvitations = vi.hoisted(() => vi.fn());
vi.mock('@queries/client', () => ({ queryClient: { invalidateQueries } }));
vi.mock('@queries/calendar/invitations', () => ({
  invalidateInvitationScheduling: invalidateInvitations,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_INBOX_SYNC_STATUS: false,
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));
vi.mock('../backfill', () => ({
  clearBackfillProgress: vi.fn(),
  invalidateBackfillJobs: vi.fn(),
  setBackfillProgress: vi.fn(),
}));
vi.mock('../link', () => ({ invalidateEmailLinks: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
describe('invitation extraction refresh', () => {
  it('refreshes mounted hosts and marks inactive message caches stale without new mail', () => {
    const refresh = vi.fn();
    const unsubscribe = onEmailThreadRefresh(refresh);
    try {
      handleRefreshEmail({
        event: 'calendar_invitations_updated',
        link_id: 'inbox',
      });
      expect(refresh).toHaveBeenCalledWith('inbox');
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: emailKeys.threadMessages._def,
        refetchType: 'none',
      });
      expect(invalidateInvitations).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
    handleRefreshEmail({
      event: 'calendar_invitations_updated',
      link_id: 'inbox',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('invalidates capabilities for scheduling messages without double-refreshing threads', () => {
    const refresh = vi.fn();
    const unsubscribe = onEmailThreadRefresh(refresh);
    try {
      handleRefreshEmail({ event: 'upsert_message', link_id: 'inbox' });
      expect(invalidateInvitations).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
  it('ignores malformed extraction events', () => {
    handleRefreshEmail({ event: 'calendar_invitations_updated' });
    handleRefreshEmail({ event: 'calendar_invitations_updated', link_id: 42 });
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(invalidateInvitations).not.toHaveBeenCalled();
  });
});
