import { describe, expect, it } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import {
  externalWriteVersion,
  predatesExternalWrite,
  recordExternalDeletion,
  recordExternalWrite,
} from './external-writes';

const fencedHost = () => ({
  deleteRecords: async () => ({
    revision: INITIAL_CACHE_REVISION,
    affectedOps: [],
  }),
});

const channel = (id: string) => ({
  item: { __typename: 'GraphqlSoupChannel', id },
});

describe('external write fences', () => {
  it('fences a deleted record only for reads sent before its deletion', () => {
    const host = fencedHost();
    const before = externalWriteVersion(host);
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);
    const after = externalWriteVersion(host);

    expect(predatesExternalWrite(host, before, channel('a'))).toBe(true);
    expect(predatesExternalWrite(host, before, channel('b'))).toBe(false);
    expect(predatesExternalWrite(host, after, channel('a'))).toBe(false);
  });

  it('finds a deleted record anywhere in a response', () => {
    const host = fencedHost();
    const before = externalWriteVersion(host);
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);

    expect(
      predatesExternalWrite(host, before, {
        user: { soup: { items: [channel('b').item, channel('a').item] } },
      })
    ).toBe(true);
  });

  it('keeps a deletion fenced under the latest deletion of the same record', () => {
    const host = fencedHost();
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);
    const between = externalWriteVersion(host);
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);

    expect(predatesExternalWrite(host, between, channel('a'))).toBe(true);
  });

  it('folds the oldest deleted records into a fence on their type past the cap', () => {
    const host = fencedHost();
    const before = externalWriteVersion(host);
    recordExternalDeletion(host, ['GraphqlSoupChannel:oldest']);
    const afterOldest = externalWriteVersion(host);
    recordExternalDeletion(
      host,
      Array.from({ length: 5_000 }, (_, index) => `GraphqlSoupChannel:${index}`)
    );
    const afterAll = externalWriteVersion(host);

    // The oldest is now held by its type: a read sent before it still drops
    // any channel, and a read sent after it no longer drops on its account.
    expect(predatesExternalWrite(host, before, channel('unrelated'))).toBe(
      true
    );
    expect(predatesExternalWrite(host, afterOldest, channel('oldest'))).toBe(
      false
    );
    expect(predatesExternalWrite(host, afterOldest, channel('4999'))).toBe(
      true
    );
    expect(predatesExternalWrite(host, afterAll, channel('4999'))).toBe(false);
    expect(
      predatesExternalWrite(host, before, {
        item: { __typename: 'GraphqlSoupDocument', id: 'd' },
      })
    ).toBe(false);
  });

  it('does not walk a response sent after the latest fence', () => {
    const host = fencedHost();
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);
    const after = externalWriteVersion(host);
    const untouchable = {
      get items(): never {
        throw new Error('walked a response no fence can drop');
      },
    };

    expect(predatesExternalWrite(host, after, untouchable)).toBe(false);
  });

  it('shares one version between type writes and deletions', () => {
    const host = fencedHost();
    recordExternalWrite(host, ['GraphqlSoupCrmContact']);
    const between = externalWriteVersion(host);
    recordExternalDeletion(host, ['GraphqlSoupChannel:a']);

    expect(externalWriteVersion(host)).toBe(between + 1);
    expect(
      predatesExternalWrite(host, between, {
        item: { __typename: 'GraphqlSoupCrmContact', id: 'c' },
      })
    ).toBe(false);
    expect(predatesExternalWrite(host, between, channel('a'))).toBe(true);
  });
});
