import { describe, expect, it } from 'vitest';
import {
  buildGraphqlEntitiesSoupInput,
  buildGraphqlEntitySoupInput,
} from './entity-input';

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
    expect(input?.initial?.filters).not.toHaveProperty('initiativeFilter');
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

  it('hydrates initiatives by their own identity without selecting folders or tasks', () => {
    expect(
      buildGraphqlEntitySoupInput('INITIATIVE', 'initiative')
    ).toMatchObject({
      initial: {
        filters: {
          initiativeFilter: { literal: { id: 'initiative' } },
          projectFilter: { literal: { projectIdSelf: nil } },
          documentFilter: { literal: { id: nil } },
        },
      },
    });
    expect(
      buildGraphqlEntitiesSoupInput([
        { entityType: 'INITIATIVE', entityId: 'initiative' },
        { entityType: 'TASK', entityId: 'task' },
      ])
    ).toMatchObject({
      initial: {
        limit: 2,
        filters: {
          initiativeFilter: { literal: { id: 'initiative' } },
          documentFilter: { literal: { id: 'task' } },
        },
      },
    });
  });

  it('does not issue empty or unsupported lookups', () => {
    expect(buildGraphqlEntitiesSoupInput([])).toBeUndefined();
    expect(
      buildGraphqlEntitiesSoupInput([{ entityType: 'USER', entityId: 'user' }])
    ).toBeUndefined();
  });
});

describe('database rows', () => {
  it('join a batch by their own ids', () => {
    expect(
      buildGraphqlEntitiesSoupInput([
        { entityType: 'DATABASE_ROW', entityId: 'row-2' },
        { entityType: 'DATABASE_ROW', entityId: 'row-1' },
      ])?.initial?.filters?.databaseRowFilter
    ).toEqual({
      or: {
        left: { literal: { id: 'row-1' } },
        right: { literal: { id: 'row-2' } },
      },
    });
  });

  it('are looked up one at a time by id with every other kind excluded', () => {
    expect(
      buildGraphqlEntitySoupInput(
        'DATABASE_ROW',
        '70000000-0000-0000-0000-000000000001'
      )
    ).toEqual({
      initial: {
        limit: 1,
        expand: true,
        sortMethod: 'UPDATED_AT',
        emailView: 'ALL',
        filters: {
          databaseRowFilter: {
            literal: { id: '70000000-0000-0000-0000-000000000001' },
          },
          calendarEventFilter: { literal: { id: nil } },
          documentFilter: { literal: { id: nil } },
          projectFilter: { literal: { projectIdSelf: nil } },
          chatFilter: { literal: { chatId: nil } },
          emailFilter: { tree: { literal: { threadId: nil } } },
          channelFilter: { literal: { channelId: nil } },
          channelThreadFilter: { literal: { threadId: nil } },
          callFilter: { literal: { callId: nil } },
          crmCompanyFilter: { literal: { id: nil } },
          foreignEntityFilter: { literal: { id: nil } },
        },
      },
    });
  });
});
