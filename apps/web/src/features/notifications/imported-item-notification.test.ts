import { describe, expect, it } from 'vitest';
import { getImportedItemSource } from './imported-item-notification';
import type { UnifiedNotification } from './types';

function notification(
  metadata: UnifiedNotification['notification_metadata'],
  createdAt: string,
  state: UnifiedNotification['state'] = 'unseen'
): UnifiedNotification {
  return {
    notification_metadata: metadata,
    created_at: createdAt,
    state,
  } as UnifiedNotification;
}

const imported = (source: 'notion' | 'linear') =>
  ({
    tag: 'item_imported',
    content: { source, itemName: 'Q4 Launch Plan' },
  }) as UnifiedNotification['notification_metadata'];

const document = (
  notifications: UnifiedNotification[],
  notificationDisplayCutoff?: string
) => ({
  type: 'document',
  notifications: () => notifications,
  notificationDisplayCutoff,
});

describe('imported item notifications', () => {
  it('reads the source of the newest outstanding import', () => {
    expect(
      getImportedItemSource(
        document([notification(imported('linear'), '2026-10-08T10:00:00Z')])
      )
    ).toBe('linear');
  });

  it('ignores done imports, newer events, and non-documents', () => {
    expect(
      getImportedItemSource(
        document([
          notification(imported('notion'), '2026-10-08T10:00:00Z', 'done'),
        ])
      )
    ).toBeUndefined();
    const comment = {
      tag: 'commented_on_document',
      content: {},
    } as unknown as UnifiedNotification['notification_metadata'];
    expect(
      getImportedItemSource(
        document([
          notification(imported('notion'), '2026-10-08T10:00:00Z'),
          notification(comment, '2026-10-08T11:00:00Z'),
        ])
      )
    ).toBeUndefined();
    expect(
      getImportedItemSource({
        type: 'channel',
        notifications: () => [
          notification(imported('notion'), '2026-10-08T10:00:00Z'),
        ],
      })
    ).toBeUndefined();
  });

  it('drops the label once newer own activity moved the cutoff past it', () => {
    expect(
      getImportedItemSource(
        document(
          [notification(imported('notion'), '2026-10-08T10:00:00Z')],
          '2026-10-08T11:00:00Z'
        )
      )
    ).toBeUndefined();
    expect(
      getImportedItemSource(
        document(
          [notification(imported('notion'), '2026-10-08T12:00:00Z')],
          '2026-10-08T11:00:00Z'
        )
      )
    ).toBe('notion');
  });
});
