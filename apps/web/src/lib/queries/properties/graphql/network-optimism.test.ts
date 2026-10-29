import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import { executeOptimisticMutation } from '@graphql-cache/exchange/optimistic';
import {
  EntityPropertiesDocument,
  SetEntityPropertyDocument,
  type SoupPropertyFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  createClient,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it } from 'vitest';
import { empty, makeSubject, mergeMap, pipe, type Subject } from 'wonka';
import { createPropertyNetworkOptimism } from './network-optimism';

const PROPERTY: SoupPropertyFieldsFragment = {
  id: 'assignment',
  propertyDefinitionId: 'priority',
  displayName: 'Priority',
  dataType: 'STRING',
  isMultiSelect: false,
  isSystem: false,
  isMetadata: false,
  specificEntityType: null,
  value: { __typename: 'GraphqlStringPropertyValue', stringValue: 'initial' },
};
const entity = (id: string, properties = [PROPERTY]) => ({
  user: {
    id: 'viewer',
    soupEntity: { __typename: 'GraphqlSoupDocument', id, properties },
  },
});
const property = (value: string) => ({
  ...PROPERTY,
  value: {
    __typename: 'GraphqlStringPropertyValue' as const,
    stringValue: value,
  },
});

type Request = { operation: Operation; response: Subject<OperationResult> };
function setup(enabled = () => true, scope = () => 0) {
  const requests: Request[] = [];
  const listeners = new Set<() => void>();
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [
      networkRevalidationExchange(
        enabled,
        createPropertyNetworkOptimism,
        scope
      ),
      () => (operations) =>
        pipe(
          operations,
          mergeMap((operation) => {
            if (operation.kind === 'teardown') return empty;
            const response = makeSubject<OperationResult>();
            requests.push({ operation, response });
            for (const listener of [...listeners]) listener();
            return response.source;
          })
        ),
    ],
  });
  async function request(index: number): Promise<Request> {
    if (requests[index]) return requests[index];
    await new Promise<void>((resolve) => {
      const ready = () => {
        if (!requests[index]) return;
        listeners.delete(ready);
        resolve();
      };
      listeners.add(ready);
    });
    return requests[index];
  }
  async function respond(index: number, data?: unknown, error?: CombinedError) {
    const current = await request(index);
    current.response.next({
      operation: current.operation,
      data,
      error,
      stale: false,
      hasNext: false,
    });
  }
  function save(id: string, value: string, onEnqueued?: () => void) {
    return executeOptimisticMutation(
      client,
      SetEntityPropertyDocument,
      {
        input: {
          entityType: 'DOCUMENT',
          entityId: id,
          propertyDefinitionId: 'priority',
          value: { string: value },
        },
      },
      { setEntityProperty: property(value) },
      { uuid: '00000000-0000-4000-8000-000000000001', onEnqueued }
    ).toPromise();
  }
  return { client, requests, request, respond, save };
}

const FAILED = new CombinedError({ graphQLErrors: [{ message: 'Rejected' }] });

describe('network property optimism', () => {
  it('acknowledges independent saves before HTTP and rolls back only the failed target', async () => {
    const { client, respond, request, save } = setup();
    const values: unknown[] = [];
    const first = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'first' },
      })
      .subscribe((result) => values.push(result.data));
    const secondValues: unknown[] = [];
    const second = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'second' },
      })
      .subscribe((result) => secondValues.push(result.data));
    await respond(0, entity('first'));
    await respond(1, entity('second'));
    let acknowledged = 0;
    const firstSave = save('first', 'one', () => acknowledged++);
    const secondSave = save('second', 'two', () => acknowledged++);
    await request(3);
    expect(acknowledged).toBe(2);
    expect(values.at(-1)).toEqual(entity('first', [property('one')]));
    expect(secondValues.at(-1)).toEqual(entity('second', [property('two')]));
    await respond(2, undefined, FAILED);
    await firstSave;
    expect(values.at(-1)).toEqual(entity('first'));
    expect(secondValues.at(-1)).toEqual(entity('second', [property('two')]));
    await respond(3, { setEntityProperty: property('two') });
    await respond(4, entity('first'));
    await respond(5, entity('second', [property('two')]));
    await secondSave;
    first.unsubscribe();
    second.unsubscribe();
  });

  it('orders conflicting writes while newer intent stays visible through an older failure', async () => {
    const { client, requests, respond, request, save } = setup();
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    await respond(0, entity('task'));
    const first = save('task', 'older');
    await request(1);
    let acknowledge!: () => void;
    const installed = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const second = save('task', 'newer', acknowledge);
    await installed;
    expect(requests).toHaveLength(2);
    expect(values.at(-1)).toEqual(entity('task', [property('newer')]));
    await respond(1, undefined, FAILED);
    await first;
    await request(2);
    expect(values.at(-1)).toEqual(entity('task', [property('newer')]));
    await respond(2, { setEntityProperty: property('newer') });
    await respond(3, entity('task', [property('newer')]));
    await second;
    expect(values.at(-1)).toEqual(entity('task', [property('newer')]));
    subscription.unsubscribe();
  });

  it('keeps confirmed values across stale refreshes and replaces temporary assignment IDs', async () => {
    const { client, respond, save } = setup();
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    await respond(0, entity('task', []));
    const saving = save('task', 'new');
    const confirmed = { ...property('new'), id: 'server-assignment' };
    await respond(1, { setEntityProperty: confirmed });
    await respond(2, entity('task', []));
    await saving;
    expect(values.at(-1)).toEqual(entity('task', [confirmed]));
    const refreshed = client
      .query(
        EntityPropertiesDocument,
        {
          input: { entityType: 'DOCUMENT', entityId: 'task' },
        },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    await respond(3, entity('task', [confirmed]));
    await refreshed;
    const changed = client
      .query(
        EntityPropertiesDocument,
        {
          input: { entityType: 'DOCUMENT', entityId: 'task' },
        },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    await respond(4, entity('task', [property('external')]));
    await changed;
    expect(values.at(-1)).toEqual(entity('task', [property('external')]));
    subscription.unsubscribe();
  });

  it('retains confirmed values after a failed refresh and rolls a later edit back to them', async () => {
    const { client, respond, save } = setup();
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    await respond(0, entity('task'));
    const first = save('task', 'confirmed');
    await respond(1, { setEntityProperty: property('confirmed') });
    await respond(2, undefined, FAILED);
    await first;
    expect(values.at(-1)).toEqual(entity('task', [property('confirmed')]));
    const second = save('task', 'rejected');
    await respond(3, undefined, FAILED);
    await second;
    expect(values.at(-1)).toEqual(entity('task', [property('confirmed')]));
    subscription.unsubscribe();
  });

  it('does not let a cache-only reader pin a confirmed value over later network data', async () => {
    const { client, requests, request, respond, save } = setup();
    const values: unknown[] = [];
    const cachedValues: unknown[] = [];
    const input = { entityType: 'DOCUMENT' as const, entityId: 'task' };
    const live = client
      .query(EntityPropertiesDocument, { input })
      .subscribe((result) => values.push(result.data));
    const cached = client
      .query(
        gql`query CachedProperties { user { soupEntity { id } } }`,
        {},
        { requestPolicy: 'cache-only' }
      )
      .subscribe((result) => cachedValues.push(result.data));
    await respond(0, entity('task'));
    await respond(1, entity('task'));
    const saving = save('task', 'saved');
    await respond(2, { setEntityProperty: property('saved') });
    await respond(3, entity('task', [property('saved')]));
    await saving;
    expect(requests).toHaveLength(4);
    const refreshed = client
      .query(
        EntityPropertiesDocument,
        { input },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    await respond(4, entity('task', [property('external')]));
    await refreshed;
    expect(values.at(-1)).toEqual(entity('task', [property('external')]));
    const rejected = save('task', 'rejected');
    await request(5);
    await respond(5, undefined, FAILED);
    await rejected;
    expect(values.at(-1)).toEqual(entity('task', [property('external')]));
    expect(cachedValues.at(-1)).toEqual(entity('task', [property('saved')]));
    live.unsubscribe();
    cached.unsubscribe();
  });

  it('does not republish a previous session snapshot for a new edit or late response', async () => {
    let session = 0;
    const { client, request, respond, save } = setup(
      () => true,
      () => session
    );
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    const old = {
      ...entity('task'),
      user: { ...entity('task').user, id: 'old-viewer' },
    };
    await respond(0, old);
    expect(values).toEqual([old]);
    session++;
    const saving = save('task', 'new-session');
    await request(1);
    expect(values).toEqual([old]);
    await respond(0, old);
    expect(values).toEqual([old]);
    await respond(1, { setEntityProperty: property('new-session') });
    await saving;
    expect(values).toEqual([old]);
    subscription.unsubscribe();
  });

  it('cancels undispatched edits and drops old optimism when the session changes', async () => {
    let session = 0;
    const { client, requests, request, respond, save } = setup(
      () => true,
      () => session
    );
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    await respond(0, entity('task'));
    const first = save('task', 'first');
    await request(1);
    let acknowledge!: () => void;
    const installed = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const second = save('task', 'queued', acknowledge);
    await installed;
    session++;
    await respond(1, { setEntityProperty: property('first') });
    await first;
    expect((await second).error?.message).toContain('session changed');
    expect(requests).toHaveLength(2);
    const refreshed = client
      .query(
        EntityPropertiesDocument,
        {
          input: { entityType: 'DOCUMENT', entityId: 'task' },
        },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    await respond(2, entity('task', [property('new-session')]));
    await refreshed;
    expect(values.at(-1)).toEqual(entity('task', [property('new-session')]));
    subscription.unsubscribe();
  });

  it('does not take ownership of a healthy-cache mutation when the cache retires later', async () => {
    let fallback = false;
    const { client, requests, request, respond, save } = setup(() => fallback);
    const values: unknown[] = [];
    const subscription = client
      .query(EntityPropertiesDocument, {
        input: { entityType: 'DOCUMENT', entityId: 'task' },
      })
      .subscribe((result) => values.push(result.data));
    await respond(0, entity('task'));
    let acknowledged = false;
    const saving = save('task', 'new', () => {
      acknowledged = true;
    });
    await request(1);
    fallback = true;
    await respond(1, undefined, FAILED);
    await saving;
    expect(acknowledged).toBe(false);
    expect(requests).toHaveLength(2);
    expect(values.at(-1)).toEqual(entity('task'));
    subscription.unsubscribe();
  });
});
