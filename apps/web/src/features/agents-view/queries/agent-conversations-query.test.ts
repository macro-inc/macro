import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { describe, expect, it } from 'vitest';
import { agentConversationsQuery } from './agent-conversations-query';

const OWNER = 'macro|dana@example.com';

describe('agentConversationsQuery', () => {
  it('lists the owner’s chats and sessions without unlisted ones', () => {
    const { body } = agentConversationsQuery(OWNER, {
      showUnlistedRuns: false,
    });

    expect(body.cf).toEqual({ l: { o: OWNER } });
    expect(body.asf).toEqual({
      '&': [
        { l: 'inc' },
        { '&': [{ l: { o: OWNER } }, { '!': { l: { vis: 'unlisted' } } }] },
      ],
    });
    // Every other entity type is pinned to an id that cannot exist.
    expect(body.df).toEqual({
      l: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });

  it('keeps unlisted sessions when asked to', () => {
    const { body } = agentConversationsQuery(OWNER, { showUnlistedRuns: true });

    expect(body.asf).toEqual({ '&': [{ l: 'inc' }, { l: { o: OWNER } }] });
  });

  it('translates the unlisted exclusion for GraphQL', () => {
    const input = makeGraphqlSoupInput(
      agentConversationsQuery(OWNER, { showUnlistedRuns: false })
    );

    expect(input.initial?.filters?.agentSessionFilter).toEqual({
      and: {
        left: { literal: { include: true } },
        right: {
          and: {
            left: { literal: { owner: OWNER } },
            right: { not: { literal: { visibility: 'UNLISTED' } } },
          },
        },
      },
    });
  });
});
