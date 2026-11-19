import { TraceFlow, useFlow } from '@app/observability/flow';
import { initializeUiOperationTelemetry } from '@app/observability/ui-operation';
import { lazy } from '@core/util/lazy';
import { guardResponseBody } from '@core/util/response-observers';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const publicationBarrier = vi.hoisted(() => ({
  wait: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('@solidjs/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solidjs/router')>();
  return {
    ...actual,
    createAsync: (load: () => Promise<unknown>) =>
      actual.createAsync(async () => {
        const result = await load();
        await publicationBarrier.wait?.();
        return result;
      }),
  };
});

vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

let nested = true;
vi.mock('@core/block', () => ({
  createBlockSignal<T>() {
    const signal = createSignal<T>();
    return Object.assign(signal, { get: signal[0], set: signal[1] });
  },
  useIsNestedBlock: () => nested,
}));
const analytics = vi.hoisted(() => ({ track: vi.fn(), pageView: vi.fn() }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => analytics,
}));
const trackBlockOpened = vi.hoisted(() => vi.fn());
vi.mock('./trackBlockOpened', () => ({ track: trackBlockOpened }));
const invalidateBundle = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@queries/client', () => ({
  useQueryClient: () => ({}),
  queryClient: { invalidateQueries: invalidateBundle },
}));
vi.mock('@service-storage/client', () => ({
  blockNameToItemType: () => 'document',
}));
let notifyAccess: (level: AccessLevel | null) => void;
vi.mock('@app/features/access-requests/access-requests', () => ({
  useSharedAccessUpdates: (
    _entity: unknown,
    apply: (
      level: AccessLevel | null,
      previous: AccessLevel | null | undefined
    ) => void
  ) => {
    const [level, setLevel] = createSignal<AccessLevel | null>();
    notifyAccess = (next) => {
      const previous = level();
      setLevel(next);
      apply(next, previous);
    };
    return level;
  },
}));

import {
  blockErrorSignal,
  blockLoadRetrySignal,
  blockSyncSourceSignal,
  blockUserAccessSignal,
} from '../signal/load';
import { BlockLoader, blockDataSignal } from './BlockLoader';

let disposeTelemetry: (() => void) | undefined;
afterEach(() => {
  cleanup();
  disposeTelemetry?.();
  vi.restoreAllMocks();
});
beforeEach(() => {
  publicationBarrier.wait = undefined;
  disposeTelemetry = initializeUiOperationTelemetry();
  nested = true;
  analytics.track.mockClear();
  analytics.pageView.mockClear();
  trackBlockOpened.mockClear();
  invalidateBundle.mockClear();
  blockDataSignal.set(undefined);
  blockErrorSignal.set(undefined);
  blockLoadRetrySignal.set(undefined);
  blockUserAccessSignal.set(undefined);
  blockSyncSourceSignal.set(undefined);
});

it('recovers a cold file load once from its identity after missing-mirror retirement', async () => {
  const body = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const nextCleanup = Promise.withResolvers<void>();
  const nextCleanupStarted = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const recovering = Promise.withResolvers<void>();
  const settled = cacheSessionGeneration.settled;
  vi.spyOn(cacheSessionGeneration, 'settled').mockImplementation(() => {
    recovering.resolve();
    return settled();
  });
  const origin = { type: 'dss' as const, id: 'document' };
  const source = { type: 'preload' as const, origin, token: 'discarded-token' };
  const load = vi.fn(async () => {
    const generation = cacheSessionGeneration.capture();
    if (load.mock.calls.length === 1) await body.promise;
    const response = guardResponseBody(new Response('%PDF-1.7'), () => {
      if (!cacheSessionGeneration.isCurrent(generation))
        throw new StaleCacheAuthorityError();
    });
    return ok({ bytes: await response.arrayBuffer() });
  });
  render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) loaded.resolve();
      })
    );
    return (
      <BlockLoader
        id="document"
        source={source}
        definition={{
          name: 'pdf',
          description: 'PDF',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  const retirement = cacheSessionGeneration.transition(() => cleanup.promise);
  body.resolve();
  await recovering.promise;
  const nextRetirement = cacheSessionGeneration.transition(() => {
    nextCleanupStarted.resolve();
    return nextCleanup.promise;
  });
  expect(load).toHaveBeenCalledOnce();
  expect(invalidateBundle).not.toHaveBeenCalled();
  cleanup.resolve();
  await nextCleanupStarted.promise;
  expect(invalidateBundle).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledOnce();
  nextCleanup.resolve();
  await retirement;
  await nextRetirement;
  await loaded.promise;
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenNthCalledWith(1, source, 'initial', expect.anything());
  expect(load).toHaveBeenNthCalledWith(2, origin, 'initial', expect.anything());
  expect(invalidateBundle).toHaveBeenCalledExactlyOnceWith({
    queryKey: ['documentLoad', 'bundle', 'document'],
    exact: true,
    refetchType: 'none',
  });
  expect(blockErrorSignal.get()).toBeNull();
});

it('rechecks the generation when an accepted result reaches the resource publication', async () => {
  const accepted = Promise.withResolvers<void>();
  const deliver = Promise.withResolvers<void>();
  const published = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  publicationBarrier.wait = () => {
    accepted.resolve();
    return deliver.promise;
  };
  const load = vi
    .fn()
    .mockResolvedValueOnce(
      ok({ id: 'retired', syncSource: { cleanup: cleanupSource } })
    )
    .mockResolvedValue(ok({ id: 'current' }));
  const seen: unknown[] = [];
  render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) {
          seen.push(data);
          published.resolve();
        }
      })
    );
    return (
      <BlockLoader
        id="document"
        source={{ type: 'dss', id: 'document' }}
        definition={{
          name: 'md',
          description: 'Document',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  await accepted.promise;
  await cacheSessionGeneration.transition(async () => {});
  publicationBarrier.wait = undefined;
  deliver.resolve();
  await published.promise;
  expect(seen).toEqual([expect.objectContaining({ id: 'current' })]);
  expect(load).toHaveBeenCalledTimes(2);
  expect(cleanupSource).toHaveBeenCalledOnce();
});

it('does not reset the retry budget when both resource deliveries are retired', async () => {
  const accepted = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const deliver = [
    Promise.withResolvers<void>(),
    Promise.withResolvers<void>(),
  ];
  const failed = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  let delivery = 0;
  publicationBarrier.wait = () => {
    const index = delivery++;
    accepted[index]?.resolve();
    return deliver[index]?.promise ?? Promise.resolve();
  };
  const load = vi.fn(async () =>
    ok({ syncSource: { cleanup: cleanupSource } })
  );
  render(() => {
    createEffect(
      on(blockErrorSignal.get, (error) => {
        if (error === 'INVALID') failed.resolve();
      })
    );
    return (
      <BlockLoader
        id="document"
        source={{ type: 'dss', id: 'document' }}
        definition={{
          name: 'md',
          description: 'Document',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  for (let index = 0; index < 2; index++) {
    await accepted[index].promise;
    await cacheSessionGeneration.transition(async () => {});
    deliver[index].resolve();
  }
  await failed.promise;
  expect(load).toHaveBeenCalledTimes(2);
  expect(cleanupSource).toHaveBeenCalledTimes(2);
  expect(blockDataSignal.get()).toBeUndefined();
});

it('cleans a stale successful load and honors a fresh denial after one recovery', async () => {
  const body = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const load = vi
    .fn()
    .mockImplementationOnce(async () => {
      await body.promise;
      return ok({
        userAccessLevel: 'owner',
        syncSource: { cleanup: cleanupSource },
      });
    })
    .mockResolvedValue(err([{ code: 'UNAUTHORIZED', message: 'No access' }]));
  render(() => {
    createEffect(
      on(blockErrorSignal.get, (error) => {
        if (error === 'UNAUTHORIZED') failed.resolve();
      })
    );
    return (
      <BlockLoader
        id="document"
        source={{ type: 'dss', id: 'document' }}
        definition={{
          name: 'md',
          description: 'Document',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  await cacheSessionGeneration.transition(async () => {});
  body.resolve();
  await failed.promise;
  expect(cleanupSource).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledTimes(2);
  expect(blockDataSignal.get()).toBeUndefined();
});

it('stops after one superseded recovery and leaves the existing retry error', async () => {
  const body = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const load = vi.fn(async () => {
    if (load.mock.calls.length === 1) await body.promise;
    else await cacheSessionGeneration.transition(async () => {});
    return ok({ id: 'stale' });
  });
  render(() => {
    createEffect(
      on(blockErrorSignal.get, (error) => {
        if (error === 'INVALID') failed.resolve();
      })
    );
    return (
      <BlockLoader
        id="document"
        source={{ type: 'dss', id: 'document' }}
        definition={{
          name: 'pdf',
          description: 'PDF',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  await cacheSessionGeneration.transition(async () => {});
  body.resolve();
  await failed.promise;
  expect(load).toHaveBeenCalledTimes(2);
  expect(blockDataSignal.get()).toBeUndefined();
});

it('preserves an open email disclosure on initial and unchanged access confirmations, but reloads on a later change', async () => {
  const loaded = Promise.withResolvers<void>();
  const reloaded = Promise.withResolvers<void>();
  const load = vi.fn(async () => ok({ id: 'email' }));
  const view = render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) {
          if (load.mock.calls.length === 1) loaded.resolve();
          else reloaded.resolve();
        }
      })
    );
    return (
      <>
        <BlockLoader
          id="01a1460f-3198-7650-9b32-a43b49108e47"
          source={{ type: 'dss', id: '01a1460f-3198-7650-9b32-a43b49108e47' }}
          definition={{
            name: 'email',
            description: 'Email',
            accepted: {},
            component: () => null,
            load,
          }}
        />
        <Show when={blockDataSignal.get()}>
          <details>
            <summary>View original email</summary>
            Original email
          </details>
        </Show>
      </>
    );
  });
  await loaded.promise;
  const disclosure = view.container.querySelector('details')!;
  fireEvent.click(view.getByText('View original email'));
  expect(disclosure.open).toBe(true);
  const data = blockDataSignal.get();

  notifyAccess('owner');
  expect(blockUserAccessSignal.get()).toBe('owner');
  expect(blockDataSignal.get()).toBe(data);
  expect(view.container.querySelector('details')).toBe(disclosure);
  expect(disclosure.open).toBe(true);
  notifyAccess('owner');
  expect(load).toHaveBeenCalledTimes(1);
  expect(disclosure.isConnected).toBe(true);
  expect(disclosure.open).toBe(true);

  notifyAccess('view');
  expect(blockDataSignal.get()).toBeUndefined();
  await reloaded.promise;
  expect(load).toHaveBeenCalledTimes(2);
  expect(blockUserAccessSignal.get()).toBe('view');
});

it('retains access confirmed before a lightweight loader finishes', async () => {
  const pending = Promise.withResolvers<{ id: string }>();
  const loaded = Promise.withResolvers<void>();
  const load = vi.fn(async () => ok(await pending.promise));
  render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) loaded.resolve();
      })
    );
    return (
      <BlockLoader
        id="01a1460f-3198-7650-9b32-a43b49108e47"
        source={{ type: 'dss', id: '01a1460f-3198-7650-9b32-a43b49108e47' }}
        definition={{
          name: 'email',
          description: 'Email',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  notifyAccess('owner');
  pending.resolve({ id: 'email' });
  await loaded.promise;
  expect(blockUserAccessSignal.get()).toBe('owner');
  notifyAccess('owner');
  expect(load).toHaveBeenCalledTimes(1);
  expect(blockDataSignal.get()).toMatchObject({ id: 'email' });
});

it('keeps document permissions unavailable until its pending load finishes', async () => {
  const pending = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const load = vi.fn(async () => {
    await pending.promise;
    return ok({ userAccessLevel: 'owner' as const });
  });
  render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) loaded.resolve();
      })
    );
    return (
      <BlockLoader
        id="01a140ad-06d5-7791-8b68-bc128654bbba"
        source={{ type: 'dss', id: '01a140ad-06d5-7791-8b68-bc128654bbba' }}
        definition={{
          name: 'write',
          description: 'Document',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });

  notifyAccess('owner');
  expect(blockDataSignal.get()).toBeUndefined();
  expect(blockUserAccessSignal.get()).toBeUndefined();
  pending.resolve();
  await loaded.promise;
  expect(blockUserAccessSignal.get()).toBe('owner');
  notifyAccess('owner');
  expect(load).toHaveBeenCalledTimes(1);
});

it.each(['MISSING', 'GONE', 'INVALID'] as const)(
  'keeps document permissions unavailable after a %s load failure',
  async (code) => {
    const failed = Promise.withResolvers<void>();
    const load = vi.fn(async () => err([{ code, message: 'Load failed' }]));
    render(() => {
      createEffect(
        on(blockErrorSignal.get, (error) => {
          if (error === code) failed.resolve();
        })
      );
      return (
        <BlockLoader
          id="01a140ad-06d5-7791-8b68-bc128654bbba"
          source={{ type: 'dss', id: '01a140ad-06d5-7791-8b68-bc128654bbba' }}
          definition={{
            name: 'write',
            description: 'Document',
            accepted: {},
            component: () => null,
            load,
          }}
        />
      );
    });
    await failed.promise;

    notifyAccess('owner');
    expect(blockDataSignal.get()).toBeUndefined();
    expect(blockUserAccessSignal.get()).toBeUndefined();
    expect(blockErrorSignal.get()).toBe(code);
    expect(load).toHaveBeenCalledTimes(1);
  }
);

it.each(['view', undefined] as const)(
  'reloads a loader-provided %s permission when the first confirmation differs',
  async (userAccessLevel) => {
    const loaded = Promise.withResolvers<void>();
    const reloaded = Promise.withResolvers<void>();
    const cleanupSource = vi.fn();
    const load = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ userAccessLevel, syncSource: { cleanup: cleanupSource } })
      )
      .mockResolvedValue(ok({ userAccessLevel: 'owner' }));
    render(() => {
      createEffect(
        on(blockDataSignal.get, (data) => {
          if (data) {
            if (load.mock.calls.length === 1) loaded.resolve();
            else reloaded.resolve();
          }
        })
      );
      return (
        <BlockLoader
          id="01a140ad-06d5-7791-8b68-bc128654bbba"
          source={{ type: 'dss', id: '01a140ad-06d5-7791-8b68-bc128654bbba' }}
          definition={{
            name: 'md',
            description: 'Document',
            accepted: {},
            component: () => null,
            load,
          }}
        />
      );
    });
    await loaded.promise;
    notifyAccess('owner');
    expect(cleanupSource).toHaveBeenCalledTimes(1);
    expect(blockDataSignal.get()).toBeUndefined();
    await reloaded.promise;
    expect(load).toHaveBeenCalledTimes(2);
    expect(blockUserAccessSignal.get()).toBe('owner');
  }
);

it('reconciles a stale permission-bearing load on a later unchanged confirmation', async () => {
  const pending = Promise.withResolvers<void>();
  const loaded = Promise.withResolvers<void>();
  const reloaded = Promise.withResolvers<void>();
  const cleanupSource = vi.fn();
  const load = vi
    .fn()
    .mockImplementationOnce(async () => {
      await pending.promise;
      return ok({
        userAccessLevel: 'edit',
        syncSource: { cleanup: cleanupSource },
      });
    })
    .mockResolvedValue(ok({ userAccessLevel: 'view' }));
  render(() => {
    createEffect(
      on(blockDataSignal.get, (data) => {
        if (data) {
          if (load.mock.calls.length === 1) loaded.resolve();
          else reloaded.resolve();
        }
      })
    );
    return (
      <BlockLoader
        id="01a140ad-06d5-7791-8b68-bc128654bbba"
        source={{ type: 'dss', id: '01a140ad-06d5-7791-8b68-bc128654bbba' }}
        definition={{
          name: 'md',
          description: 'Document',
          accepted: {},
          component: () => null,
          load,
        }}
      />
    );
  });
  notifyAccess('view');
  pending.resolve();
  await loaded.promise;
  notifyAccess('view');
  expect(cleanupSource).toHaveBeenCalledTimes(1);
  expect(blockDataSignal.get()).toBeUndefined();
  await reloaded.promise;
  expect(load).toHaveBeenCalledTimes(2);
  expect(blockUserAccessSignal.get()).toBe('view');
});

it('drops a revoked open document, cleans its source, and loads fresh credentials after regrant', async () => {
  const cleanupSource = vi.fn();
  const load = vi.fn(async () =>
    ok({
      userAccessLevel: 'edit' as const,
      syncSource: { cleanup: cleanupSource },
    })
  );
  render(() => (
    <BlockLoader
      id="01a140ad-06d5-7791-8b68-bc128654bbba"
      source={{ type: 'dss', id: '01a140ad-06d5-7791-8b68-bc128654bbba' }}
      definition={{
        name: 'md',
        description: 'Document',
        accepted: {},
        component: () => null,
        load,
      }}
    />
  ));
  await vi.waitFor(() => expect(blockUserAccessSignal.get()).toBe('edit'));
  notifyAccess('edit');
  expect(load).toHaveBeenCalledTimes(1);
  notifyAccess(null);
  expect(blockUserAccessSignal.get()).toBeUndefined();
  expect(blockDataSignal.get()).toBeUndefined();
  expect(blockErrorSignal.get()).toBe('UNAUTHORIZED');
  expect(cleanupSource).toHaveBeenCalledTimes(1);
  notifyAccess('edit');
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(blockUserAccessSignal.get()).toBe('edit'));
  expect(blockErrorSignal.get()).toBeNull();
  expect(blockLoadRetrySignal.get()).toBe(1);
});

it('records an open of a block that tracks history', async () => {
  nested = false;
  render(() => (
    <BlockLoader
      id="01a1460f-3198-7650-9b32-a43b49108e47"
      source={{ type: 'dss', id: '01a1460f-3198-7650-9b32-a43b49108e47' }}
      definition={{
        name: 'md',
        description: 'Document',
        accepted: {},
        component: () => null,
        load: async () => ok({ id: 'md' }),
      }}
    />
  ));
  await vi.waitFor(() => expect(trackBlockOpened).toHaveBeenCalledOnce());
  expect(trackBlockOpened).toHaveBeenCalledWith({
    itemId: '01a1460f-3198-7650-9b32-a43b49108e47',
    blockName: 'md',
    client: expect.any(Function),
  });
});

it('reports an open for a block without open history that asks for it', async () => {
  nested = false;
  render(() => (
    <BlockLoader
      id="01a1460f-3198-7650-9b32-a43b49108e47"
      source={{ type: 'dss', id: '01a1460f-3198-7650-9b32-a43b49108e47' }}
      definition={{
        name: 'database',
        description: 'Database',
        accepted: {},
        component: () => null,
        openTrackingEnabled: false,
        openAnalyticsEnabled: true,
        load: async () => ok({ id: 'database' }),
      }}
    />
  ));
  await vi.waitFor(() =>
    expect(analytics.track).toHaveBeenCalledWith('open_entity', {
      entityType: 'database',
      entityId: '01a1460f-3198-7650-9b32-a43b49108e47',
    })
  );
  expect(analytics.pageView).not.toHaveBeenCalled();
  expect(trackBlockOpened).not.toHaveBeenCalled();
});

it('reports no open for a block without open history by default', async () => {
  nested = false;
  render(() => (
    <BlockLoader
      id="calendar"
      source={{ type: 'dss', id: 'calendar' }}
      definition={{
        name: 'calendar',
        description: 'Calendar',
        accepted: {},
        component: () => null,
        openTrackingEnabled: false,
        load: async () => ok({ id: 'calendar' }),
      }}
    />
  ));
  await vi.waitFor(() =>
    expect(blockDataSignal.get()).toMatchObject({ id: 'calendar' })
  );
  expect(analytics.track).not.toHaveBeenCalledWith(
    'open_entity',
    expect.anything()
  );
  expect(analytics.pageView).not.toHaveBeenCalled();
});

it('holds the enclosing view until both data and component code are ready', async () => {
  const data = Promise.withResolvers<{ id: string }>();
  const code = Promise.withResolvers<void>();
  const published = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const ready = vi.fn(() => settled.resolve());
  function ObserveReady() {
    const span = useFlow().span;
    const setAttr = span.setAttr.bind(span);
    vi.spyOn(span, 'setAttr').mockImplementation((key, value) => {
      setAttr(key, value);
      if (key === 'ui.work_to_ready_ms') ready();
    });
    return null;
  }
  render(() => {
    createEffect(() => {
      if (blockDataSignal.get()) published.resolve();
    });
    return (
      <TraceFlow name="view.document">
        <ObserveReady />
        <BlockLoader
          id="document"
          source={{ type: 'dss', id: 'document' }}
          definition={{
            name: 'email',
            description: 'Email',
            accepted: {},
            component: lazy(async () => {
              await code.promise;
              return { default: () => null };
            }),
            load: async () => ok(await data.promise),
          }}
        />
      </TraceFlow>
    );
  });
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  data.resolve({ id: 'document' });
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  code.resolve();
  await published.promise;
  await settled.promise;
  expect(ready).toHaveBeenCalledOnce();
});
