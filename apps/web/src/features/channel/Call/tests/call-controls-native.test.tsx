/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallControls } from '../CallControls/CallControls';

const mocks = vi.hoisted(() => ({ platform: 'ios' }));

vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: (platform: string) => platform === mocks.platform,
}));
vi.mock('../native-call-state', () => ({
  useMaybeNativeCallState: () => ({ snapshot: () => ({ channelId: 'c' }) }),
}));
vi.mock('../use-callkit', () => ({
  setNativeCallKitVideoOverlayMode: vi.fn(async () => {}),
}));

afterEach(cleanup);

describe('native call controls', () => {
  it.each(['ios', 'android'])('keep extra buttons on %s', (platform) => {
    mocks.platform = platform;
    render(() => (
      <CallControls
        onLeave={() => undefined}
        extra={<button type="button">Copy Meeting Url</button>}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Copy Meeting Url' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Leave call' })).toBeNull();
  });
});
