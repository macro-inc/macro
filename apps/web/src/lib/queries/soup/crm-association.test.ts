import { QueryClient } from '@tanstack/solid-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, refreshActiveGraphqlSoupQueries } = vi.hoisted(() => ({
  client: { current: undefined as unknown as QueryClient },
  refreshActiveGraphqlSoupQueries: vi.fn(async () => {}),
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client.current;
  },
}));
vi.mock('./graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries,
}));

import {
  hasCrmAssociation,
  messageReferencesCrmRecord,
  refreshCrmAssociatedSoupQueries,
} from './crm-association';
import { soupKeys } from './keys';

const filesBody = {
  df: {
    '&': [
      { '!': { l: { dst: 'task' } } },
      { '|': [{ l: { crm: { company: 'c' } } }, { l: { eap: 'a@b.c' } }] },
    ],
  },
};

const listKey = (body: unknown) =>
  soupKeys.astItems({ params: { limit: 100 }, body: body as never }).queryKey;

describe('CRM-associated Soup lists', () => {
  beforeEach(() => {
    client.current = new QueryClient();
    refreshActiveGraphqlSoupQueries.mockClear();
  });

  it('recognizes the scope and document literals', () => {
    expect(hasCrmAssociation({ crma: { contact: 'c' } })).toBe(true);
    expect(hasCrmAssociation(filesBody)).toBe(true);
    expect(hasCrmAssociation({ df: { l: { dst: 'task' } } })).toBe(false);
    expect(hasCrmAssociation({ propf: { l: { crm: {} } } })).toBe(false);
    expect(hasCrmAssociation(undefined)).toBe(false);
  });

  it('recognizes CRM message references', () => {
    expect(
      messageReferencesCrmRecord({
        mentions: [{ entity_type: 'user' }, { entity_type: 'crm_contact' }],
      })
    ).toBe(true);
    expect(
      messageReferencesCrmRecord({
        attachments: [{ entity_type: 'crm_company' }],
      })
    ).toBe(true);
    expect(
      messageReferencesCrmRecord({
        mentions: [{ entity_type: 'document' }],
        attachments: [{ entity_type: 'document' }],
      })
    ).toBe(false);
    expect(messageReferencesCrmRecord({})).toBe(false);
  });

  it('refetches only associated lists on both transports', async () => {
    const lists = {
      files: listKey(filesBody),
      tasks: listKey({ df: { l: { dst: 'task' } } }),
      search: soupKeys.search({
        params: {},
        body: { crma: { company: 'c' } } as never,
      }).queryKey,
    };
    for (const queryKey of Object.values(lists)) {
      client.current.setQueryData(queryKey, { items: [] });
    }

    await refreshCrmAssociatedSoupQueries();

    const invalidated = (queryKey: readonly unknown[]) =>
      client.current.getQueryState(queryKey)?.isInvalidated;
    expect(invalidated(lists.files)).toBe(true);
    expect(invalidated(lists.tasks)).toBe(false);
    expect(invalidated(lists.search)).toBe(false);
    expect(refreshActiveGraphqlSoupQueries).toHaveBeenCalledWith({
      where: hasCrmAssociation,
    });
  });

  it('skips REST invalidation when no associated list is cached', async () => {
    client.current.setQueryData(listKey({ df: { l: { dst: 'task' } } }), {
      items: [],
    });
    const invalidate = vi.spyOn(client.current, 'invalidateQueries');

    await refreshCrmAssociatedSoupQueries();

    expect(invalidate).not.toHaveBeenCalled();
    expect(refreshActiveGraphqlSoupQueries).toHaveBeenCalled();
  });
});
