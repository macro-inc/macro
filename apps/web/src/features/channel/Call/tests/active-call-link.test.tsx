/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActiveCallLink } from '../ActiveCallLink';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: false, loading: true }),
  query: vi.fn(),
}));
vi.mock('../../../meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => mocks.flag,
}));
vi.mock('@queries/call/meetings', () => ({ useCallLinkQuery: mocks.query }));
vi.mock('../CallContext', () => ({
  useCallContext: () => ({ activeCallId: () => 'channel-call' }),
}));

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockReturnValue({ isSuccess: false, isError: false });
});
afterEach(cleanup);

it('does not mount link queries while loading/off and still requires an explicit request when enabled', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  render(() => <ActiveCallLink />);
  expect(mocks.query).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
  setFlag({ enabled: false, loading: false });
  expect(mocks.query).not.toHaveBeenCalled();

  setFlag({ enabled: true, loading: false });
  expect(mocks.query).toHaveBeenCalledOnce();
  const requestedCallId = mocks.query.mock.calls[0][0];
  expect(requestedCallId()).toBeUndefined();
  fireEvent.click(
    screen.getByRole('button', { name: 'Get shareable call link' })
  );
  expect(requestedCallId()).toBe('channel-call');

  setFlag({ enabled: false, loading: false });
  expect(screen.queryByText('Preparing call link…')).toBeNull();
  setFlag({ enabled: true, loading: false });
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls[1][0]()).toBeUndefined();
  expect(
    screen.getByRole('button', { name: 'Get shareable call link' })
  ).toBeTruthy();
});
