/**
 * @vitest-environment jsdom
 */

import type { CustomToastConfig } from '@core/component/Toast/Toast';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNotificationModal } from './BrowserNotificationModal';

type PromptOptions = {
  persistent?: boolean;
  region?: string;
  onUserDismiss?: () => void;
};

const mocks = vi.hoisted(() => ({
  custom: vi.fn((_config: CustomToastConfig, _options?: PromptOptions) => 1),
  dismiss: vi.fn(),
  toggle: vi.fn(async (_enabled: boolean) => {}),
  mobile: false,
  dismissPrompt: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/util/platform', () => ({ isPlatform: () => false }));
vi.mock('@core/context/user', () => ({
  useTutorialCompleted: () => () => true,
}));
vi.mock('@queries/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('../notification-settings', () => ({
  useNotificationSettings: () => ({
    isSupported: true,
    shouldPrompt: () => true,
    dismissPrompt: mocks.dismissPrompt,
    toggle: mocks.toggle,
    isEnabled: () => true,
  }),
}));

function MockToaster() {
  return (
    <>
      <button onClick={() => mocks.custom.mock.lastCall?.[1]?.onUserDismiss?.()}>
        Dismiss
      </button>
      <button
        onClick={() => mocks.custom.mock.lastCall?.[0].actions?.[0]?.onClick()}
      >
        Enable
      </button>
    </>
  );
}

function renderPrompt() {
  return render(() => (
    <>
      <BrowserNotificationModal />
      <MockToaster />
    </>
  ));
}

beforeEach(() => vi.stubEnv('DEV', false));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('browser notification prompt', () => {
  it('waits in the phone prompt region, which open sheets cover', () => {
    mocks.mobile = true;
    renderPrompt();

    expect(mocks.custom).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Enable Browser Notifications' }),
      expect.objectContaining({
        persistent: true,
        region: 'mobile-prompt-region',
        onUserDismiss: expect.any(Function),
      })
    );
  });

  it('joins the other prompts on desktop', () => {
    mocks.mobile = false;
    renderPrompt();

    expect(mocks.custom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        persistent: true,
        region: 'prompt-region',
        onUserDismiss: expect.any(Function),
      })
    );
  });

  it('offers Enable as its only action', () => {
    renderPrompt();

    const [config] = mocks.custom.mock.calls[0]!;
    expect(config.actions?.map((action) => action.label)).toEqual(['Enable']);
  });

  it('persists user dismissal through notification settings', () => {
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(mocks.dismissPrompt).toHaveBeenCalledOnce();
    expect(mocks.toggle).not.toHaveBeenCalled();
  });

  it('enables notifications without persisting dismissal', async () => {
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith(1));
    expect(mocks.toggle).toHaveBeenCalledWith(true);
    expect(mocks.dismissPrompt).not.toHaveBeenCalled();
  });
});
