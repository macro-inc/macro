import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { cleanup, render } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

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
    apply: (level: AccessLevel | null) => void
  ) => {
    const [level, setLevel] = createSignal<AccessLevel | null>();
    notifyAccess = (next) => {
      setLevel(next);
      apply(next);
    };
    return level;
  },
}));

import {
  blockErrorSignal,
  blockLoadRetrySignal,
  blockUserAccessSignal,
} from '../signal/load';
import { BlockLoader, blockDataSignal } from './BlockLoader';

afterEach(cleanup);

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
