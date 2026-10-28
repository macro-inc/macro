import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHasActiveChannelsCall } from './use-has-active-call';

const mocks = vi.hoisted(() => ({
  enabled: true,
  flag: () => ({ enabled: true, loading: false }),
  userId: (): string | undefined => undefined,
  channelQuery: vi.fn(),
  quickCalls: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_CALLS() {
    return mocks.enabled;
  },
}));
vi.mock('../meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => mocks.flag,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => mocks.userId }));
vi.mock('@queries/call/call', () => ({
  useActiveCallsQuery: mocks.channelQuery,
}));
vi.mock('../meetings/queries/active-quick-calls', () => ({
  useActiveQuickCallsSource: mocks.quickCalls,
}));

const disposers: (() => void)[] = [];

beforeEach(() => {
  mocks.enabled = true;
  mocks.flag = () => ({ enabled: true, loading: false });
  mocks.channelQuery.mockReset();
  mocks.quickCalls.mockReset();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  const [userId, setUserId] = createSignal<string | undefined>(
    'macro|viewer@example.com'
  );
  const [channelCalls, setChannelCalls] = createSignal<string[]>([]);
  const [quickCalls, setQuickCalls] = createSignal<string[]>([]);
  const [pending, setPending] = createSignal(false);
  mocks.userId = userId;
  mocks.channelQuery.mockReturnValue({
    get isPending() {
      return pending();
    },
    get data() {
      if (pending()) throw new Error('A pending query resource was read');
      return channelCalls();
    },
  });
  mocks.quickCalls.mockImplementation(
    (enabledUserId: () => string | undefined) => ({
      calls: () => (enabledUserId() ? quickCalls() : []),
    })
  );
  const active = createRoot((dispose) => {
    disposers.push(dispose);
    return useHasActiveChannelsCall();
  });
  return { active, setChannelCalls, setQuickCalls, setPending, setUserId };
}

it('shows the indicator for either call type and clears after both end', () => {
  const state = setup();
  expect(state.active()).toBe(false);
  state.setQuickCalls(['quick']);
  expect(state.active()).toBe(true);
  state.setChannelCalls(['channel']);
  state.setQuickCalls([]);
  expect(state.active()).toBe(true);
  state.setChannelCalls([]);
  expect(state.active()).toBe(false);
  expect(mocks.quickCalls).toHaveBeenCalledOnce();
  expect(mocks.quickCalls.mock.calls[0][0]()).toBe(mocks.userId());
});

it('can show a quick call without reading pending channel data', () => {
  const state = setup();
  state.setPending(true);
  expect(state.active()).toBe(false);
  state.setQuickCalls(['quick']);
  expect(state.active()).toBe(true);
});

it('hides retained indicators after signing out', () => {
  const state = setup();
  state.setChannelCalls(['channel']);
  state.setQuickCalls(['quick']);
  expect(state.active()).toBe(true);
  state.setUserId(undefined);
  expect(state.active()).toBe(false);
});

it('does not mount either call query while calls are disabled', () => {
  mocks.enabled = false;
  const state = setup();
  state.setChannelCalls(['channel']);
  state.setQuickCalls(['quick']);
  expect(state.active()).toBe(false);
  expect(mocks.channelQuery).not.toHaveBeenCalled();
  expect(mocks.quickCalls).not.toHaveBeenCalled();
});

it('preserves channel indicators while the quick-call flag loads or is disabled', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  const state = setup();
  state.setQuickCalls(['quick']);
  expect(mocks.quickCalls).toHaveBeenCalledOnce();
  expect(mocks.quickCalls.mock.calls[0][0]()).toBeUndefined();
  expect(state.active()).toBe(false);
  state.setChannelCalls(['channel']);
  expect(state.active()).toBe(true);

  setFlag({ enabled: false, loading: false });
  expect(mocks.quickCalls).toHaveBeenCalledOnce();
  expect(mocks.quickCalls.mock.calls[0][0]()).toBeUndefined();
  expect(state.active()).toBe(true);
  state.setChannelCalls([]);
  setFlag({ enabled: true, loading: false });
  expect(mocks.quickCalls).toHaveBeenCalledOnce();
  expect(state.active()).toBe(true);

  setFlag({ enabled: false, loading: false });
  expect(mocks.quickCalls).toHaveBeenCalledOnce();
  expect(state.active()).toBe(false);
  state.setChannelCalls(['channel']);
  expect(state.active()).toBe(true);
});
