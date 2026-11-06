import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessRequestVisitProvider } from './context/visit';
import { useShareRequestTrigger } from './share-request-trigger';

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
let snapshot: {
  isSuccess: boolean;
  isFetchedAfterMount: boolean;
  data: { canReview: boolean; pendingCount: number };
  refetch(): Promise<{
    isSuccess: boolean;
    data: { canReview: boolean; pendingCount: number };
  }>;
};
vi.mock('@queries/access-requests/requests', () => ({
  useAccessRequestState: () => snapshot,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(initialCount: number) {
  const responses: (() => void)[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        private callback: (entries: { isIntersecting: boolean }[]) => void
      ) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    }
  );
  const [state, update] = createStore({
    isSuccess: true,
    isFetchedAfterMount: false,
    data: { canReview: true, pendingCount: initialCount },
  });
  snapshot = {
    get isSuccess() {
      return state.isSuccess;
    },
    get isFetchedAfterMount() {
      return state.isFetchedAfterMount;
    },
    get data() {
      return state.data;
    },
    refetch: () =>
      new Promise((resolve) =>
        responses.push(() =>
          resolve({ isSuccess: true, data: { ...state.data } })
        )
      ),
  };
  const [id, navigate] = createSignal('one');
  const open = vi.fn();
  let trigger: ReturnType<typeof useShareRequestTrigger>;
  function Trigger() {
    trigger = useShareRequestTrigger({
      entity: () => ({ entityType: 'document', entityId: id() }),
      active: () => true,
      open,
    });
    return (
      <button ref={trigger.ref} onClick={trigger.open}>
        Share
      </button>
    );
  }
  render(() => (
    <AccessRequestVisitProvider visit={id()}>
      <Trigger />
    </AccessRequestVisitProvider>
  ));
  return {
    update,
    open,
    navigate,
    count: () => trigger.count(),
    async settle() {
      responses.shift()?.();
      await Promise.resolve();
    },
  };
}

describe('Share request trigger', () => {
  it('waits for a fresh snapshot, opens once, and resets on navigation', async () => {
    const { update, open, navigate, settle } = setup(1);
    expect(open).not.toHaveBeenCalled();
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    update('data', 'pendingCount', 2);
    expect(open).toHaveBeenCalledTimes(1);
    navigate('two');
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('updates the badge without opening for requests arriving during a visit', async () => {
    const { update, open, count, settle } = setup(0);
    await settle();
    update('data', 'pendingCount', 1);
    expect(count()).toBe(1);
    expect(open).not.toHaveBeenCalled();
    update('data', 'canReview', false);
    expect(count()).toBe(0);
  });

  it('keeps the loaded request count through a background refresh error', async () => {
    const { update, count, settle } = setup(3);
    await settle();
    update('isSuccess', false);
    expect(count()).toBe(3);
  });

  it('ignores cached pending requests that are resolved in the fresh snapshot', async () => {
    const { update, open, settle } = setup(1);
    update('data', 'pendingCount', 0);
    await settle();
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores a response from the visit that was navigated away from', async () => {
    const { navigate, open, update, settle } = setup(1);
    navigate('two');
    await settle();
    expect(open).not.toHaveBeenCalled();
    update('data', 'pendingCount', 0);
    await settle();
    expect(open).not.toHaveBeenCalled();
  });
});
