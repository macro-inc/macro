/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ActiveCallHeader, JoinableCallStatus } from '../ActiveCallHeader';

const mocks = vi.hoisted(() => ({ setActiveTab: vi.fn() }));
vi.mock('@channel/Channel/ChannelTabContext', () => ({
  useChannelTab: () => ({ setActiveTab: mocks.setActiveTab }),
}));
vi.mock('../call-tabs', () => ({ getCallJoinTab: () => 'call' }));
vi.mock('../CallContext', () => ({ useCallContextOptional: () => undefined }));
vi.mock('../ActiveCallLink', () => ({ ActiveCallLink: () => null }));
vi.mock('@core/component/UserGroup', () => ({ UserGroup: () => null }));
vi.mock('@queries/call/call', () => ({
  useActiveCallQuery: () => ({
    isSuccess: true,
    data: { callId: 'call-1', createdAt: new Date().toISOString() },
  }),
  useLiveCallRecordQuery: () => ({
    isSuccess: true,
    data: { participants: [] },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens the pre-join tab from the unjoined status pill', async () => {
  render(() => <JoinableCallStatus channelId="channel-1" />);
  await fireEvent.click(screen.getByRole('button', { name: 'Open call' }));
  expect(mocks.setActiveTab).toHaveBeenCalledExactlyOnceWith('call');
});

it('returns to the call view from the active status pill', async () => {
  render(() => <ActiveCallHeader channelId="channel-1" />);
  await fireEvent.click(screen.getByRole('button', { name: 'Open call' }));
  expect(mocks.setActiveTab).toHaveBeenCalledExactlyOnceWith('call');
});
