/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallAloneWatcher } from '../CallAloneWatcher';
import type { CallAloneWarningEvent } from '../call-events';

const mocks = vi.hoisted(() => ({
  handlers: {} as {
    onCallAloneWarning?: (event: CallAloneWarningEvent) => void;
    onCallAloneCleared?: (event: { channelId: string; callId: string }) => void;
    onCallEnded?: (event: { channelId: string; callId: string }) => void;
  },
  ios: false,
  nativeStay: undefined as ((callId: string) => void) | undefined,
  stayInCall: vi.fn(async (_callId: string) => {}),
  showNative: vi.fn(async (_callId: string, _endsAt: number) => {}),
  dismissNative: vi.fn(async (_callId: string) => {}),
}));

const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
const [nativeSnapshot, setNativeSnapshot] = createSignal<{
  callId: string;
} | null>(null);

vi.mock('../CallContext', () => ({
  useCallContext: () => ({ activeCallId }),
}));
vi.mock('../call-events', () => ({
  createCallEventsEffect: (handlers: typeof mocks.handlers) => {
    mocks.handlers = handlers;
  },
}));
vi.mock('../native-call-state', () => ({
  useMaybeNativeCallState: () => ({ snapshot: nativeSnapshot }),
}));
vi.mock('../use-callkit', () => ({
  isNativeIosCallKitEnabled: () => mocks.ios,
  registerAlonePromptStayHandler: (handler: (callId: string) => void) => {
    mocks.nativeStay = handler;
    return () => {
      mocks.nativeStay = undefined;
    };
  },
  showNativeAlonePrompt: mocks.showNative,
  dismissNativeAlonePrompt: mocks.dismissNative,
}));
vi.mock('@queries/call/call', () => ({ stayInCall: mocks.stayInCall }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

function warn(callId: string, inMs: number, channelId = 'channel-1') {
  const event = { channelId, callId, endsAt: Date.now() + inMs };
  mocks.handlers.onCallAloneWarning?.(event);
  return event;
}

describe('alone-in-call prompt', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn());
    mocks.ios = false;
    mocks.handlers = {};
    mocks.nativeStay = undefined;
    mocks.stayInCall.mockClear();
    mocks.showNative.mockClear();
    mocks.dismissNative.mockClear();
    setActiveCallId('call-1');
    setNativeSnapshot(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks a lone user to stay and keeps the call going', async () => {
    render(() => <CallAloneWatcher />);
    warn('call-1', 120_000);
    expect(await screen.findByText("You're the only one here")).toBeTruthy();
    expect(
      // The countdown is live; under load it may already have ticked.
      screen.getByText(/It will end in (2:00|1:[0-5]\d) unless you stay/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay in call' }));
    await waitFor(() =>
      expect(mocks.stayInCall).toHaveBeenCalledExactlyOnceWith('call-1')
    );
    await waitFor(
      () => expect(screen.queryByText("You're the only one here")).toBeNull(),
      { timeout: 2_000 }
    );
  });

  it('ignores warnings for other calls and closes at the deadline', async () => {
    render(() => <CallAloneWatcher />);
    warn('call-2', 120_000);
    warn('call-1', 400);
    expect(await screen.findByText("You're the only one here")).toBeTruthy();
    await waitFor(
      () => expect(screen.queryByText("You're the only one here")).toBeNull(),
      { timeout: 2_000 }
    );
    expect(mocks.stayInCall).not.toHaveBeenCalled();
  });

  it('stays dismissed for a repeated warning but reopens for a new deadline', async () => {
    render(() => <CallAloneWatcher />);
    const first = warn('call-1', 120_000);
    await screen.findByText("You're the only one here");
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.queryByText("You're the only one here")).toBeNull()
    );
    mocks.handlers.onCallAloneWarning?.({ ...first });
    expect(screen.queryByText("You're the only one here")).toBeNull();
    warn('call-1', 90_000);
    expect(await screen.findByText("You're the only one here")).toBeTruthy();
  });

  it('closes when someone joins or the call ends', async () => {
    render(() => <CallAloneWatcher />);
    warn('call-1', 120_000);
    await screen.findByText("You're the only one here");
    mocks.handlers.onCallAloneCleared?.({
      channelId: 'channel-1',
      callId: 'call-1',
    });
    await waitFor(() =>
      expect(screen.queryByText("You're the only one here")).toBeNull()
    );
  });

  it('uses the native alert for an iOS CallKit call', async () => {
    mocks.ios = true;
    setNativeSnapshot({ callId: 'CALL-1' });
    render(() => <CallAloneWatcher />);
    const event = warn('call-1', 120_000);
    expect(mocks.showNative).toHaveBeenCalledExactlyOnceWith(
      'call-1',
      event.endsAt
    );
    expect(screen.queryByText("You're the only one here")).toBeNull();
    mocks.nativeStay?.('CALL-2');
    expect(mocks.stayInCall).not.toHaveBeenCalled();
    mocks.nativeStay?.('CALL-1');
    await waitFor(() =>
      expect(mocks.stayInCall).toHaveBeenCalledExactlyOnceWith('call-1')
    );
    expect(mocks.dismissNative).toHaveBeenCalledExactlyOnceWith('call-1');
  });
});
