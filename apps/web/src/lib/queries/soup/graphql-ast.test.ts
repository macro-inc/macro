import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { describe, expect, it } from 'vitest';
import {
  makeGraphqlGroupedSoupContinuationInput,
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from './graphql-ast';

const UPDATED_AT = '2026-01-01T00:00:00.000Z';

function makeInput(query: Parameters<typeof queryStateFrom>[0]) {
  return makeGraphqlSoupInput({
    params: { limit: 100, sort_method: 'updated_at' },
    body: compileToAst(queryStateFrom(query)),
  });
}

describe('makeGraphqlSoupInput', () => {
  it('maps compiled soup AST and request params into GraphQL Soup input', () => {
    const input = makeInput({
      include: {
        documentDone: false,
        documentUpdatedAt: { gte: UPDATED_AT },
        emailShared: 'exclude',
      },
      emailView: 'inbox',
    });

    expect(input).toMatchObject({
      initial: {
        limit: 100,
        expand: true,
        sortMethod: 'UPDATED_AT',
        emailView: 'INBOX',
        filters: {
          documentFilter: {
            and: {
              left: { literal: { notificationDone: false } },
              right: { literal: { updatedAt: { gte: UPDATED_AT } } },
            },
          },
          emailFilter: {
            tree: { literal: { shared: 'EXCLUDE' } },
          },
        },
      },
    });
  });

  it('maps channel participation filters into the channel literal', () => {
    // The inbox signal view pins channelIsParticipant: [true] so it only ever
    // shows channels the user is in.
    const input = makeInput({
      include: {
        channelDone: false,
        channelIsParticipant: [true],
      },
    });

    expect(input).toMatchObject({
      initial: {
        filters: {
          channelFilter: {
            and: {
              left: { literal: { notificationDone: false } },
              right: { literal: { isParticipant: true } },
            },
          },
        },
      },
    });
  });

  it('ORs multiple channel participation states so non-member team channels match', () => {
    // The Channels → Teams tab queries [true, false]: member channels plus
    // team channels of the user's teams they haven't joined.
    const input = makeInput({
      include: {
        channelIsParticipant: [true, false],
      },
    });

    expect(input).toMatchObject({
      initial: {
        filters: {
          channelFilter: {
            or: {
              left: { literal: { isParticipant: true } },
              right: { literal: { isParticipant: false } },
            },
          },
        },
      },
    });
  });

  it('maps cursor requests without resending filters or sort', () => {
    const input = makeGraphqlSoupInput({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom({
          include: { documentDone: false },
          emailView: 'sent',
        })
      ),
      cursor: 'opaque-cursor',
    });

    expect(input).toEqual({
      continuation: {
        cursor: 'opaque-cursor',
        expand: true,
        emailView: 'SENT',
      },
    });
  });

  it('maps grouped requests to GraphQL input', () => {
    const input = makeGraphqlGroupedSoupInput({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom({ include: { documentDone: false } })),
      groupBy: {
        type: 'property',
        propertyDefinitionId: '00000000-0000-0000-0000-000000000001',
        entityType: 'TASK',
      },
    });

    expect(input).toMatchObject({
      initial: {
        groupBy: {
          field: 'PROPERTY',
          propertyDefinitionId: '00000000-0000-0000-0000-000000000001',
          entityType: 'TASK',
        },
        limit: 100,
        sortMethod: 'UPDATED_AT',
        filters: {
          documentFilter: { literal: { notificationDone: false } },
        },
      },
    });
  });

  it('maps grouped cursor continuations to GraphQL input', () => {
    expect(
      makeGraphqlGroupedSoupContinuationInput({
        groupBy: { type: 'entity_type' },
        groupKey: 'document',
        cursor: 'opaque-cursor',
      })
    ).toEqual({
      continuation: {
        groupBy: { field: 'ENTITY_TYPE' },
        groupKey: 'document',
        cursor: 'opaque-cursor',
      },
    });
  });

  it('maps property filter values', () => {
    const input = makeInput({
      include: {
        properties: [
          {
            propertyId: '00000000-0000-0000-0000-000000000001',
            type: 'select',
            value: '00000000-0000-0000-0000-000000000002',
          },
        ],
      },
    });

    expect(input).toMatchObject({
      initial: {
        filters: {
          propertiesFilter: {
            literal: {
              propertyDefinitionId: '00000000-0000-0000-0000-000000000001',
              value: { selectOption: '00000000-0000-0000-0000-000000000002' },
            },
          },
        },
      },
    });
  });

  it('maps channel thread participant filters', () => {
    const input = makeGraphqlSoupInput({
      params: { limit: 100, sort_method: 'updated_at' },
      body: { cthf: { l: { Participant: 'user-1' } } } as never,
    });

    expect(input).toMatchObject({
      initial: {
        filters: {
          channelThreadFilter: {
            literal: { participant: 'user-1' },
          },
        },
      },
    });
  });

  it('throws for REST-only file association literals so callers can fall back', () => {
    expect(() =>
      makeInput({
        include: { fileAssoc: ['assoc:pdf'] },
      })
    ).toThrow('Unsupported GraphQL Soup AST');
  });

  it('throws for frecency sort so callers can fall back', () => {
    expect(() =>
      makeGraphqlSoupInput({
        params: { limit: 100, sort_method: 'frecency' },
        body: compileToAst(queryStateFrom({})),
      })
    ).toThrow('Unsupported GraphQL Soup AST');
  });

  it('throws for invalid call statuses so callers can fall back', () => {
    expect(() =>
      makeGraphqlSoupInput({
        params: { limit: 100, sort_method: 'updated_at' },
        body: { callf: { l: { Status: 'BOGUS' } } } as never,
      })
    ).toThrow('Unsupported GraphQL Soup AST');
  });
});
