import { cleanup, render } from '@solidjs/testing-library';
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
  expect(apply).toHaveBeenLastCalledWith('edit');
  update('data', 'accessLevel', null);
  expect(apply).toHaveBeenLastCalledWith(null);
  expect(access!()).toBeNull();
  const calls = apply.mock.calls.length;
  update('isSuccess', false);
  expect(access!()).toBeNull();
  expect(apply).toHaveBeenCalledTimes(calls);
  update('data', 'accessLevel', 'view');
  update('isSuccess', true);
  expect(apply).toHaveBeenLastCalledWith('view');
});
