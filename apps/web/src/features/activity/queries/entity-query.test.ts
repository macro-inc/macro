import { describe, expect, it } from 'vitest';
import { soupPage } from '../tests/wire';
import { createdEvent } from './fixtures';
import { selectEntityActivity } from './select-entity-activity';

describe('selectEntityActivity', () => {
  it('returns entity-missing when the soup page omits the entity', () => {
    expect(selectEntityActivity(soupPage([]), 'doc-1')).toEqual({
      kind: 'entity-missing',
    });
  });

  it('returns found when the entity is present, even with no events', () => {
    expect(
      selectEntityActivity(
        soupPage([
          {
            __typename: 'GraphqlSoupDocument',
            id: 'doc-1',
            activity: [],
          },
        ]),
        'doc-1'
      )
    ).toEqual({ kind: 'found', events: [] });
  });

  it('decodes events on the matching soup item', () => {
    expect(
      selectEntityActivity(
        soupPage([
          {
            __typename: 'GraphqlSoupDocument',
            id: 'doc-1',
            activity: [createdEvent],
          },
        ]),
        'doc-1'
      )
    ).toEqual({
      kind: 'found',
      events: [
        {
          id: 'evt-1',
          actorId: 'macro|sarah@example.com',
          entityId: 'doc-1',
          entityType: 'document',
          occurredAt: '2026-08-21T12:00:00.000Z',
          action: { kind: 'created' },
        },
      ],
    });
  });
});
