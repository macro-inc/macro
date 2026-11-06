/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ReturnToCallButton } from './return-to-call-button';

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: () => {} }),
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => ({
    isInCall: () => true,
    activeCallId: () => 'call-1',
  }),
}));
vi.mock('@channel/Call/CallWaveform', () => ({ CallWaveform: () => <span /> }));
vi.mock('@channel/Call/use-active-call-companion', () => ({
  useActiveCallCompanion: () => ({
    inCallView: () => true,
    open: async () => {},
  }),
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(cleanup);

it('shows the active-call rail trigger even while the call view is open', async () => {
  render(() => <ReturnToCallButton />);
  await Promise.resolve();
  expect(screen.getByRole('button', { name: 'Return to call' })).toBeTruthy();
});
