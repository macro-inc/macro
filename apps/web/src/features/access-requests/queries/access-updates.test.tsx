import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccessLevel } from '../core/types';
import { useSharedAccessUpdates } from './access-updates';

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
let snapshot: {
  isSuccess: boolean;
  isFetchedAfterMount: boolean;
  data: { accessLevel: AccessLevel | null };
};
vi.mock('@queries/access-requests/requests', () => ({
  useAccessRequestState: () => snapshot,
}));
afterEach(cleanup);

it('ignores initial cache and failures, but propagates confirmed removal and a later grant', () => {
  const [state, update] = createStore({
    isSuccess: true,
    isFetchedAfterMount: false,
    data: { accessLevel: 'edit' as AccessLevel | null },
  });
  snapshot = state;
  const apply = vi.fn();
  let access: ReturnType<typeof useSharedAccessUpdates>;
  function Host() {
    access = useSharedAccessUpdates(
      () => ({ entityType: 'document', entityId: 'document' }),
      apply
    );
    return null;
  }
  render(() => <Host />);
  expect(apply).not.toHaveBeenCalled();
  expect(access!()).toBeUndefined();
  update('isFetchedAfterMount', true);
  expect(apply).toHaveBeenLastCalledWith('edit', undefined);
  update('data', 'accessLevel', null);
  expect(apply).toHaveBeenLastCalledWith(null, 'edit');
  expect(access!()).toBeNull();
  const calls = apply.mock.calls.length;
  update('isSuccess', false);
  expect(access!()).toBeNull();
  expect(apply).toHaveBeenCalledTimes(calls);
  update('data', 'accessLevel', 'view');
  update('isSuccess', true);
  expect(apply).toHaveBeenLastCalledWith('view', null);
});

it('reports the previous confirmation for refreshes and resets it for a new entity', () => {
  const [state, update] = createStore({
    isSuccess: true,
    isFetchedAfterMount: true,
    data: { accessLevel: 'owner' as AccessLevel | null },
  });
  snapshot = state;
  const [entityId, setEntityId] = createSignal('first');
  const apply = vi.fn();
  function Host() {
    useSharedAccessUpdates(
      () => ({ entityType: 'document', entityId: entityId() }),
      apply
    );
    return null;
  }
  render(() => <Host />);
  expect(apply).toHaveBeenLastCalledWith('owner', undefined);
  update('isSuccess', false);
  expect(apply).toHaveBeenCalledTimes(1);
  update('isSuccess', true);
  expect(apply).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith('owner', 'owner');

  setEntityId('second');
  expect(apply).toHaveBeenCalledTimes(3);
  expect(apply).toHaveBeenLastCalledWith('owner', undefined);
  update('data', 'accessLevel', 'view');
  expect(apply).toHaveBeenLastCalledWith('view', 'owner');
});
