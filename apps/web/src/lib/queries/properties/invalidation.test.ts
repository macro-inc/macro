import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { expect, it, vi } from 'vitest';
import {
  invalidateAllPropertyReads,
  invalidateEntityPropertyReads,
  registerEntityPropertyReader,
} from './invalidation';
import { propertiesKeys } from './keys';

it('updates individual and batched readers together, including GraphQL observers', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let value = 'Contract';
  const single = new QueryObserver(client, {
    queryKey: propertiesKeys.entity({
      entityType: 'DOCUMENT',
      entityId: 'shared',
    }).queryKey,
    queryFn: async () => value,
  });
  const batch = new QueryObserver(client, {
    queryKey: propertiesKeys.entityBatch({
      userId: 'viewer',
      entityType: 'DOCUMENT',
      entityIds: ['shared'],
      propertyIds: ['file-type'],
    }).queryKey,
    queryFn: async () => value,
  });
  const stopSingle = single.subscribe(() => {});
  const stopBatch = batch.subscribe(() => {});
  const graphql = vi.fn(async () => value);
  const unrelated = vi.fn(async () => {});
  const stopGraphql = registerEntityPropertyReader(client, {
    entityId: 'shared',
    refetch: graphql,
  });
  const stopUnrelated = registerEntityPropertyReader(client, {
    entityId: 'other',
    refetch: unrelated,
  });
  try {
    await Promise.all([single.refetch(), batch.refetch()]);
    value = 'Proposal';
    await invalidateEntityPropertyReads(
      client,
      'DOCUMENT',
      'shared',
      'queries'
    );
    expect(single.getCurrentResult().data).toBe('Proposal');
    expect(batch.getCurrentResult().data).toBe('Proposal');
    expect(graphql).not.toHaveBeenCalled();
    value = 'Invoice';
    await invalidateEntityPropertyReads(client, 'DOCUMENT', 'shared');
    expect(single.getCurrentResult().data).toBe('Invoice');
    expect(batch.getCurrentResult().data).toBe('Invoice');
    expect(graphql).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
    stopGraphql();
    await invalidateEntityPropertyReads(client, 'DOCUMENT', 'shared');
    expect(graphql).toHaveBeenCalledOnce();
  } finally {
    stopSingle();
    stopBatch();
    stopGraphql();
    stopUnrelated();
    client.clear();
  }
});

it('an option rename refreshes active catalogs, option menus and file readers', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  let label = 'Contract';
  const keys = [
    [
      ...propertiesKeys.definitions({ scope: 'team', includeOptions: true })
        .queryKey,
      'user',
      'team',
    ],
    propertiesKeys.options({ propertyDefinitionId: 'file-type' }).queryKey,
    propertiesKeys.entity({ entityType: 'DOCUMENT', entityId: 'shared' })
      .queryKey,
  ];
  const observers = keys.map(
    (queryKey) =>
      new QueryObserver(client, { queryKey, queryFn: async () => label })
  );
  const stops = observers.map((observer) => observer.subscribe(() => {}));
  const graphql = vi.fn(async () => label);
  stops.push(
    registerEntityPropertyReader(client, {
      entityId: 'shared',
      refetch: graphql,
    })
  );
  try {
    await Promise.all(observers.map((observer) => observer.refetch()));
    label = 'Agreement';
    await invalidateAllPropertyReads(client);
    expect(
      observers.map((observer) => observer.getCurrentResult().data)
    ).toEqual(['Agreement', 'Agreement', 'Agreement']);
    expect(graphql).toHaveBeenCalledOnce();
  } finally {
    for (const stop of stops) stop();
    client.clear();
  }
});
