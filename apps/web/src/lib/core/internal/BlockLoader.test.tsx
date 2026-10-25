import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

vi.mock('@core/block', () => ({
  createBlockSignal<T>() {
    const signal = createSignal<T>();
    return Object.assign(signal, { get: signal[0], set: signal[1] });
  },
  useIsNestedBlock: () => true,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({}),
}));
vi.mock('@queries/client', () => ({ useQueryClient: () => ({}) }));
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

afterEach(cleanup);
beforeEach(() => {
  blockDataSignal.set(undefined);
  blockErrorSignal.set(undefined);
  blockLoadRetrySignal.set(undefined);
  blockUserAccessSignal.set(undefined);
  blockSyncSourceSignal.set(undefined);
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
