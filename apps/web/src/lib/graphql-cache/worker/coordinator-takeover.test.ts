import { describe, expect, it } from 'vitest';
import { cacheDatabaseIdentity } from './coordinator-protocol';
import {
  cacheTakeoverChannelName,
  parseCacheTakeoverMessage,
} from './coordinator-takeover';

describe('cache takeover messages', () => {
  const request = {
    takeover: 1,
    kind: 'request',
    scope: 'scope',
    requestId: 'r1',
    buildTime: 1_790_000_000_000,
  };
  const reply = {
    takeover: 1,
    kind: 'reply',
    scope: 'scope',
    requestId: 'r1',
    decision: 'yield',
  };

  it('names one channel per database, shared only by builds that open it', () => {
    expect(cacheTakeoverChannelName('scope')).toBe(
      `graphql-cache-takeover:${cacheDatabaseIdentity('scope')}`
    );
    expect(cacheTakeoverChannelName('scope')).toBe(
      'graphql-cache-takeover:graphql-cache:scope'
    );
  });

  it('reads requests and replies from any build, ignoring added fields', () => {
    expect(parseCacheTakeoverMessage(request)).toEqual(request);
    expect(parseCacheTakeoverMessage(reply)).toEqual(reply);
    expect(
      parseCacheTakeoverMessage({ ...request, addedByALaterBuild: true })
    ).toEqual(request);
    expect(parseCacheTakeoverMessage({ ...reply, decision: 'keep' })).toEqual({
      ...reply,
      decision: 'keep',
    });
  });

  it('ignores anything it cannot act on', () => {
    for (const invalid of [
      undefined,
      'request',
      [request],
      { ...request, takeover: 2 },
      { ...request, scope: '' },
      { ...request, requestId: '' },
      { ...request, buildTime: -1 },
      { ...request, buildTime: 1.5 },
      { ...request, kind: 'announce' },
      { ...reply, decision: 'maybe' },
    ]) {
      expect(parseCacheTakeoverMessage(invalid)).toBeUndefined();
    }
  });
});
