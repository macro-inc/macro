import { describe, expect, it } from 'vitest';
import { buildGraphqlEntitiesSoupInput } from './entity-input';

const nil = '00000000-0000-0000-0000-000000000000';

describe('batched entity Soup inputs', () => {
  it('targets exact IDs across types and excludes unrelated branches', () => {
    const input = buildGraphqlEntitiesSoupInput([
      { entityType: 'DOCUMENT', entityId: 'doc-2' },
      { entityType: 'TASK', entityId: 'doc-1' },
      { entityType: 'DOCUMENT', entityId: 'doc-1' },
      { entityType: 'CHANNEL', entityId: 'channel-1' },
      { entityType: 'THREAD', entityId: 'email-1' },
    ]);
    expect(input).toMatchObject({
      initial: {
        limit: 4,
        expand: true,
        emailView: 'ALL',
        filters: {
          documentFilter: {
            or: {
              left: { literal: { id: 'doc-1' } },
              right: { literal: { id: 'doc-2' } },
            },
          },
          channelFilter: { literal: { channelId: 'channel-1' } },
          emailFilter: { tree: { literal: { threadId: 'email-1' } } },
          calendarEventFilter: { literal: { id: nil } },
          channelThreadFilter: { literal: { threadId: nil } },
          chatFilter: { literal: { chatId: nil } },
          projectFilter: { literal: { projectIdSelf: nil } },
          callFilter: { literal: { callId: nil } },
          crmCompanyFilter: { literal: { id: nil } },
          foreignEntityFilter: { literal: { id: nil } },
        },
      },
    });
  });

  it('has deterministic variables and balanced trees for a full batch', () => {
    const entities = Array.from({ length: 50 }, (_, i) => ({
      entityType: 'DOCUMENT' as const,
      entityId: `doc-${i}`,
    }));
    const input = buildGraphqlEntitiesSoupInput(entities);
    expect(input).toEqual(buildGraphqlEntitiesSoupInput(entities.toReversed()));
    const depth = (value: unknown): number =>
      !value || typeof value !== 'object'
        ? 0
        : 1 + Math.max(0, ...Object.values(value).map(depth));
    expect(depth(input)).toBeLessThan(64);
    expect(input?.initial?.limit).toBe(50);
  });

  it('does not issue empty or unsupported lookups', () => {
    expect(buildGraphqlEntitiesSoupInput([])).toBeUndefined();
    expect(
      buildGraphqlEntitiesSoupInput([{ entityType: 'USER', entityId: 'user' }])
    ).toBeUndefined();
  });
});
