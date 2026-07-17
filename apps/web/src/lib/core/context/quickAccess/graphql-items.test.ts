import type { IndexedEntityItem } from '@graphql-cache/index';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));

import { indexedEntityToQuickAccessItem } from './graphql-items';

function indexed(
  overrides: Partial<IndexedEntityItem> &
    Pick<IndexedEntityItem, 'bucket' | 'entity'>
): IndexedEntityItem {
  return {
    id: 'entity-1',
    sortTimestamp: 123,
    ...overrides,
  };
}

describe('indexedEntityToQuickAccessItem', () => {
  it('maps indexed document subtypes and preserves index ordering metadata', () => {
    const item = indexedEntityToQuickAccessItem(
      indexed({
        bucket: 'document',
        entity: {
          id: 'entity-1',
          documentName: 'My task',
          ownerId: 'user-1',
          fileType: 'md',
          viewedAt: '2025-01-01T00:00:00Z',
          subType: { kind: 'TASK', isCompleted: true },
        },
      })
    );

    expect(item).toMatchObject({
      id: 'entity-1',
      bucket: 'task',
      sortTimestamp: 123,
      data: {
        type: 'document',
        name: 'My task',
        fileType: 'md',
        subType: { type: 'task', is_completed: true },
      },
    });
  });

  it('maps GraphQL field names from indexed snapshots', () => {
    const cases = [
      ['chat', { chatName: 'Chat' }],
      ['project', { projectName: 'Project' }],
      ['email', { emailName: 'Email' }],
      ['crm_company', { crmCompanyName: 'Company', crmTeamId: 'team-1' }],
    ] as const;

    for (const [bucket, entity] of cases) {
      expect(
        indexedEntityToQuickAccessItem(
          indexed({
            bucket,
            entity: { id: 'entity-1', ownerId: 'user-1', ...entity },
          })
        )?.data.name
      ).toBe(Object.values(entity)[0]);
    }
  });

  it('maps direct-message channels from indexed snapshots', () => {
    const item = indexedEntityToQuickAccessItem(
      indexed({
        id: 'channel-1',
        bucket: 'channel',
        entity: {
          id: 'channel-1',
          channelName: 'Taylor',
          ownerId: 'user-1',
          channelType: 'DIRECT_MESSAGE',
        },
      })
    );

    expect(item).toMatchObject({
      id: 'channel-1',
      bucket: 'dm',
      data: {
        type: 'channel',
        name: 'Taylor',
        channelType: 'direct_message',
      },
    });
  });
});
