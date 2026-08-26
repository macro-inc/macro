import { describe, expect, it } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  databaseOwnerLockName,
  isCachePush,
  isCacheRequest,
  isCacheResponse,
  validateCoordinatorToEngineEnvelope,
  validateCoordinatorToTabEnvelope,
  validateEngineToCoordinatorEnvelope,
  validatePageToEngineEnvelope,
  validateTabToCoordinatorEnvelope,
} from './coordinator-protocol';

const version = {
  coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
} as const;

const enginePort = {
  postMessage() {},
  close() {},
  start() {},
} as unknown as MessagePort;

describe('coordinator runtime protocol', () => {
  it('validates cache RPCs and rejects unknown fields or kinds', () => {
    expect(isCacheRequest({ id: 0, kind: 'clear' })).toBe(true);
    expect(isCacheRequest({ id: 1, kind: 'current-revision' })).toBe(true);
    expect(isCacheRequest({ id: 1, kind: 'read', query: '{ x }' })).toBe(true);
    expect(
      isCacheRequest({
        id: 2,
        kind: 'write',
        originOpId: 'client:1',
        registration: {
          opId: 'client:1',
          entityResolvers: [
            {
              parentType: 'GraphqlUser',
              fieldName: 'emailThread',
              targetType: 'GraphqlSoupEmailThread',
              argumentPath: ['input', 'threadId'],
            },
          ],
        },
        query: '{ user { id } }',
        data: { user: { id: 'user-1' } },
      })
    ).toBe(true);
    expect(
      isCacheRequest({
        id: 2,
        kind: 'write',
        registration: { opId: '', entityResolvers: [] },
        query: '{ user { id } }',
        data: { user: { id: 'user-1' } },
      })
    ).toBe(false);
    expect(
      isCacheRequest({
        id: 2,
        kind: 'read-records-by-keys',
        document: 'fragment Item on GraphqlSoupDocument { name }',
        fragmentName: 'Item',
        keys: ['GraphqlSoupDocument:one'],
      })
    ).toBe(true);
    expect(
      isCacheRequest({
        id: 2,
        kind: 'search',
        request: {
          profile: 'quick-access-v1',
          buckets: ['document'],
          query: 'plan',
          limit: 20,
          nowMs: 123,
        },
      })
    ).toBe(true);
    expect(
      isCacheRequest({
        id: 2,
        kind: 'search',
        request: {
          profile: 'quick-access-v1',
          buckets: ['document'],
          query: 'plan',
          limit: 20,
          nowMs: 123,
          extra: true,
        },
      })
    ).toBe(false);
    expect(isCacheRequest({ id: 1, kind: 'clear', surprise: true })).toBe(
      false
    );
    expect(isCacheRequest({ id: 1, kind: 'future-kind' })).toBe(false);
    expect(isCacheResponse({ id: 3, ok: true, result: undefined })).toBe(true);
    expect(isCacheResponse({ id: 3, ok: false, error: 'failed' })).toBe(true);
    expect(
      isCacheResponse({
        id: 3,
        ok: false,
        error: 'failed',
        errorCode: 'owner-epoch-lost',
      })
    ).toBe(true);
    expect(
      isCacheResponse({
        id: 3,
        ok: false,
        error: 'failed',
        errorCode: 'future-code',
      })
    ).toBe(false);
    expect(isCacheResponse({ id: 3, ok: false, error: 4 })).toBe(false);
    expect(
      isCachePush({
        kind: 'cache-changed',
        revision: INITIAL_CACHE_REVISION,
      })
    ).toBe(true);
    expect(
      isCachePush({
        kind: 'mutation-settled',
        settlement: { transactionId: '1', status: 'committed' },
      })
    ).toBe(true);
  });

  it('enforces search and record-key bounds at coordinator ingress', () => {
    const validSearch = {
      profile: 'quick-access-v1',
      buckets: ['document'],
      query: 'plan',
      limit: 20,
      nowMs: 123,
    };
    const acceptsSearch = (request: Record<string, unknown>) =>
      isCacheRequest({ id: 2, kind: 'search', request });

    expect(acceptsSearch({ ...validSearch, limit: 501 })).toBe(false);
    expect(acceptsSearch({ ...validSearch, query: 'é'.repeat(257) })).toBe(
      false
    );
    expect(acceptsSearch({ ...validSearch, buckets: ['Invalid'] })).toBe(false);
    expect(acceptsSearch({ ...validSearch, nowMs: -1 })).toBe(false);
    expect(
      acceptsSearch({
        ...validSearch,
        cursor: { timestampMs: 1, recordKey: 'ROOT_QUERY' },
      })
    ).toBe(false);

    const selectionRequest = (keys: string[]) =>
      isCacheRequest({
        id: 2,
        kind: 'read-records-by-keys',
        document: 'fragment Item on GraphqlSoupDocument { name }',
        fragmentName: 'Item',
        keys,
      });
    expect(selectionRequest(['ROOT_QUERY'])).toBe(false);
    expect(selectionRequest([`Thing:${'x'.repeat(1024)}`])).toBe(false);
  });

  it.each([
    {
      ...version,
      kind: 'register-tab',
      scope: 'scope',
      tabId: 'tab',
      livenessLockName: 'graphql-cache-tab:scope:tab',
    },
    {
      ...version,
      kind: 'cache-request',
      tabId: 'tab',
      request: { id: 1, kind: 'clear' },
    },
    {
      ...version,
      kind: 'attach-engine-port',
      tabId: 'tab',
      ownerEpoch: 1,
      enginePort,
    },
    {
      ...version,
      kind: 'graceful-departure',
      tabId: 'tab',
      ownerEpoch: 1,
    },
    {
      ...version,
      kind: 'navigation-departure',
      tabId: 'tab',
      ownerEpoch: 1,
      reason: 'pagehide',
    },
    {
      ...version,
      kind: 'engine-lost',
      tabId: 'tab',
      ownerEpoch: 1,
      reason: 'failed',
    },
    {
      ...version,
      kind: 'disconnect-tab',
      tabId: 'tab',
      reason: 'closed',
    },
  ])('accepts tab envelope $kind', (message) => {
    expect(validateTabToCoordinatorEnvelope(message)).toEqual({
      ok: true,
      value: message,
    });
  });

  it.each([
    { ...version, kind: 'registered', tabId: 'tab' },
    {
      ...version,
      kind: 'become-owner',
      scope: 'scope',
      tabId: 'tab',
      ownerEpoch: 1,
      databaseAction: 'open-existing',
      ownerLockName: 'owner-lock',
    },
    {
      ...version,
      kind: 'cache-message',
      message: { id: 1, ok: true, result: null },
    },
    {
      ...version,
      kind: 'terminate-engine',
      tabId: 'tab',
      ownerEpoch: 1,
      reason: 'failed',
    },
    {
      ...version,
      kind: 'retire-complete',
      tabId: 'tab',
      ownerEpoch: 1,
    },
    { ...version, kind: 'engine-replaced', ownerEpoch: 2 },
    { ...version, kind: 'protocol-error', error: 'bad envelope' },
  ])('accepts coordinator-to-tab envelope $kind', (message) => {
    expect(validateCoordinatorToTabEnvelope(message).ok).toBe(true);
  });

  it('validates activation and both direct-port directions', () => {
    expect(
      validatePageToEngineEnvelope({
        ...version,
        kind: 'activate-engine',
        scope: 'scope',
        tabId: 'tab',
        ownerEpoch: 1,
        databaseAction: 'wipe-before-open',
        ownerLockName: 'owner-lock',
      }).ok
    ).toBe(true);
    expect(
      validateCoordinatorToEngineEnvelope({
        ...version,
        kind: 'engine-request',
        ownerEpoch: 1,
        routeId: 7,
        request: { id: 7, kind: 'clear' },
      }).ok
    ).toBe(true);
    expect(
      validateCoordinatorToEngineEnvelope({
        ...version,
        kind: 'engine-request',
        ownerEpoch: 1,
        routeId: 7,
        request: { id: 6, kind: 'clear' },
      }).ok
    ).toBe(false);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'engine-ready',
        tabId: 'tab',
        ownerEpoch: 1,
        ownerLockName: 'owner-lock',
        ownerLockHeld: true,
        databaseActionProof: 'wiped-before-open',
        openOutcome: 'reset-storage-uncertain',
      }).ok
    ).toBe(true);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'engine-ready',
        tabId: 'tab',
        ownerEpoch: 1,
        ownerLockName: 'owner-lock',
        ownerLockHeld: false,
        databaseActionProof: 'wiped-before-open',
        openOutcome: 'reset-storage-uncertain',
      }).ok
    ).toBe(false);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'engine-fatal',
        tabId: 'tab',
        ownerEpoch: 1,
        reason: 'reset',
        fatalCode: 'storage-reset-required',
      }).ok
    ).toBe(true);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'activation-failed',
        tabId: 'tab',
        ownerEpoch: 1,
        reason: 'open failed',
        failureCode: 'recovery-open-failed',
      }).ok
    ).toBe(true);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'engine-response',
        ownerEpoch: 1,
        routeId: 7,
        response: {
          id: 7,
          ok: false,
          error: 'forged topology loss',
          errorCode: 'owner-epoch-lost',
        },
      }).ok
    ).toBe(false);
  });

  it('rejects missing versions, non-positive epochs, extra fields, and malformed nested payloads', () => {
    expect(
      validateTabToCoordinatorEnvelope({
        kind: 'register-tab',
        scope: 'scope',
        tabId: 'tab',
        livenessLockName: 'lock',
      }).ok
    ).toBe(false);
    expect(
      validateCoordinatorToTabEnvelope({
        ...version,
        kind: 'engine-replaced',
        ownerEpoch: 0,
      }).ok
    ).toBe(false);
    expect(
      validateCoordinatorToTabEnvelope({
        coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION + 1,
        kind: 'engine-replaced',
        ownerEpoch: 1,
      }).ok
    ).toBe(false);
    expect(
      validateEngineToCoordinatorEnvelope({
        ...version,
        kind: 'heartbeat-ack',
        ownerEpoch: 1,
        heartbeatId: 1,
        extra: true,
      }).ok
    ).toBe(false);
    expect(
      validateCoordinatorToEngineEnvelope({
        ...version,
        kind: 'engine-request',
        ownerEpoch: 1,
        routeId: 1,
        request: { id: 1, kind: 'unknown' },
      }).ok
    ).toBe(false);
  });

  it('derives the exact UTF-8 canonical turso-opfs lock name', () => {
    expect(databaseOwnerLockName('scope')).toBe(
      'macro:turso-opfs:v1:19:graphql-cache:scope'
    );
    expect(databaseOwnerLockName('é')).toBe(
      'macro:turso-opfs:v1:16:graphql-cache:é'
    );
  });
});
