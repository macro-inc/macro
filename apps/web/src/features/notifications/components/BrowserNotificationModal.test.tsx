/**
 * @vitest-environment jsdom
 */

import type { CustomToastConfig } from '@core/component/Toast/Toast';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNotificationModal } from './BrowserNotificationModal';

type PromptOptions = {
  persistent?: boolean;
  region?: string;
  onUserDismiss?: () => void;
};

const mocks = vi.hoisted(() => ({
  custom: vi.fn((_config: CustomToastConfig, _options?: PromptOptions) => 1),
  mobile: false,
  dismissPrompt: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: mocks.custom, dismiss: vi.fn() },
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
    toggle: vi.fn(),
  }),
}));

beforeEach(() => vi.stubEnv('DEV', false));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('browser notification prompt', () => {
  it('waits in the phone prompt region, which open sheets cover', () => {
    mocks.mobile = true;
    render(() => <BrowserNotificationModal />);

    expect(mocks.custom).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Enable Browser Notifications' }),
      expect.objectContaining({
        persistent: true,
        region: 'mobile-prompt-region',
      })
    );
  });

  it('joins the other prompts on desktop', () => {
    mocks.mobile = false;
    render(() => <BrowserNotificationModal />);

    expect(mocks.custom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ persistent: true, region: 'prompt-region' })
    );
  });

  it('offers Enable as its only action', () => {
    render(() => <BrowserNotificationModal />);

    const [config] = mocks.custom.mock.calls[0]!;
    expect(config.actions?.map((action) => action.label)).toEqual(['Enable']);
  });

  it('stops asking once the user closes it', () => {
    render(() => <BrowserNotificationModal />);

    const [, options] = mocks.custom.mock.calls[0]!;
    options?.onUserDismiss?.();

    expect(mocks.dismissPrompt).toHaveBeenCalledOnce();
  });
});
