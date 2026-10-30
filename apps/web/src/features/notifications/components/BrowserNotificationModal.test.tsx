/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNotificationModal } from './BrowserNotificationModal';

const mocks = vi.hoisted(() => ({
  custom: vi.fn(() => 1),
  mobile: false,
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
    dismissPrompt: vi.fn(),
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
  it('waits in the phone prompt region, which steps aside for open sheets', () => {
    mocks.mobile = true;
    render(() => <BrowserNotificationModal />);

    expect(mocks.custom).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Enable Browser Notifications' }),
      { persistent: true, region: 'mobile-prompt-region' }
    );
  });

  it('joins the other prompts on desktop', () => {
    mocks.mobile = false;
    render(() => <BrowserNotificationModal />);

    expect(mocks.custom).toHaveBeenCalledWith(expect.anything(), {
      persistent: true,
      region: 'prompt-region',
    });
  });
});
