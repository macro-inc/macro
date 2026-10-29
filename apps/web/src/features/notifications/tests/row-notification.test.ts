import type { WithNotification } from '@entity/types/notification';
import { describe, expect, it } from 'vitest';
import { getAccessRequestNotification } from '../row-notification';
import type { UnifiedNotification } from '../types';

function notification(
  id: string,
  tag: string,
  state: UnifiedNotification['state'],
  createdAt: string
): UnifiedNotification {
  return {
    id,
    state,
    created_at: createdAt,
    notification_metadata: { tag, content: { accessLevel: 'edit' } },
  } as unknown as UnifiedNotification;
}

function row(
  type: string,
  notifications: UnifiedNotification[]
): WithNotification<{ type: string }> {
  return { type, notifications: () => notifications };
}

describe('getAccessRequestNotification', () => {
  it('names the newest pending request on any entity type', () => {
    const older = notification(
      'older',
      'entity_access_requested',
      'seen',
      '2026-10-29T15:00:00Z'
    );
    const newer = notification(
      'newer',
      'entity_access_requested',
      'unseen',
      '2026-10-29T15:45:00Z'
    );
    expect(
      getAccessRequestNotification(row('initiative', [older, newer]))
    ).toBe(newer);
    expect(getAccessRequestNotification(row('document', [newer]))).toBe(newer);
  });

  it('ignores resolved requests and other notification kinds', () => {
    const resolved = notification(
      'resolved',
      'entity_access_requested',
      'done',
      '2026-10-29T15:45:00Z'
    );
    const comment = notification(
      'comment',
      'initiative_discussion',
      'unseen',
      '2026-10-29T16:00:00Z'
    );
    expect(getAccessRequestNotification(row('initiative', [resolved]))).toBe(
      undefined
    );
    // The newest outstanding notification wins the row, whatever its kind.
    const request = notification(
      'request',
      'entity_access_requested',
      'unseen',
      '2026-10-29T15:45:00Z'
    );
    expect(
      getAccessRequestNotification(row('initiative', [request, comment]))
    ).toBe(undefined);
    expect(getAccessRequestNotification(row('initiative', []))).toBe(undefined);
  });
});
