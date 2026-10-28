import type { SoupUpdatesSubscription } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerActiveGraphqlSoupQuery } from './active-queries';
import {
  listCanIncludeCalls,
  revalidateCallListsForSoupUpdates,
} from './call-list-revalidation';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type SoupPatch = SoupUpdatesSubscription['soupUpdates'][number];

function updated(typename: string): SoupPatch {
  return {
    __typename: 'SoupUpdated',
    item: { __typename: typename, id: crypto.randomUUID() },
  } as unknown as SoupPatch;
}

function registerList(body: unknown) {
  const refresh = vi.fn(async () => {});
  onTestFinished(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh,
      body: () => body,
    })
  );
  return refresh;
}

describe('listCanIncludeCalls', () => {
  it('includes lists that leave calls unfiltered or filter them by status', () => {
    expect(listCanIncludeCalls({ df: { l: { id: NIL_UUID } } })).toBe(true);
    expect(listCanIncludeCalls({ callf: { l: { Status: 'MISSED' } } })).toBe(
      true
    );
  });

  it('excludes lists whose call filter provably selects nothing', () => {
    expect(listCanIncludeCalls({ callf: { l: { CallId: NIL_UUID } } })).toBe(
      false
    );
    expect(
      listCanIncludeCalls({
        callf: {
          '&': [{ l: { Status: 'MISSED' } }, { l: { CallId: NIL_UUID } }],
        },
      })
    ).toBe(false);
  });

  it('keeps negated or OR-ed exclusions refreshable', () => {
    expect(
      listCanIncludeCalls({ callf: { '!': { l: { CallId: NIL_UUID } } } })
    ).toBe(true);
    expect(
      listCanIncludeCalls({
        callf: {
          '|': [{ l: { CallId: NIL_UUID } }, { l: { Status: 'MISSED' } }],
        },
      })
    ).toBe(true);
  });

  it('skips readers without a list filter body', () => {
    expect(listCanIncludeCalls(undefined)).toBe(false);
  });
});

describe('revalidateCallListsForSoupUpdates', () => {
  it('refreshes only mounted lists that can contain a newly updated call', async () => {
    const callsList = registerList({ df: { l: { id: NIL_UUID } } });
    const documentsList = registerList({ callf: { l: { CallId: NIL_UUID } } });

    await revalidateCallListsForSoupUpdates([updated('GraphqlSoupCall')]);

    expect(callsList).toHaveBeenCalledTimes(1);
    expect(documentsList).not.toHaveBeenCalled();
  });

  it('ignores patches that carry no call update', async () => {
    const callsList = registerList({});

    await revalidateCallListsForSoupUpdates([
      updated('GraphqlSoupDocument'),
      {
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName: 'GraphqlSoupCall',
        entityId: crypto.randomUUID(),
      },
    ]);

    expect(callsList).not.toHaveBeenCalled();
  });
});
