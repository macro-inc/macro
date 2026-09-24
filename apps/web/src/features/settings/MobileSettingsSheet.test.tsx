import type { SettingsTab } from '@core/constant/SettingsState';
import type { SettingsTabGroup } from '@core/constant/settingsTabsConfig';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileSettingsState } from './context/mobile-settings';
import { MobileSettingsSheet } from './MobileSettingsSheet';

vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const groups: SettingsTabGroup[] = [
  {
    label: 'Account',
    items: [{ tab: 'Account', label: 'Account', icon: () => <svg /> }],
  },
];

function setup(tab: SettingsTab) {
  const settings = createMobileSettingsState();
  const [availableGroups, setAvailableGroups] = createSignal(groups);
  const onClose = vi.fn(settings.close);
  const renderPage = vi.fn((page: SettingsTab) => <div>{page} form</div>);
  settings.openSettings(tab);
  render(() => (
    <MobileSettingsSheet
      open={settings.open()}
      page={settings.page()}
      groups={availableGroups()}
      name="Test User"
      email="test@example.com"
      avatar={<span>T</span>}
      onClose={onClose}
      onNavigate={settings.selectPage}
      onLogout={() => {}}
      renderPage={renderPage}
    />
  ));
  return { settings, setAvailableGroups, onClose, renderPage };
}

describe('unavailable mobile settings sections', () => {
  it.each<SettingsTab>(['Admin', 'CRM', 'Subscription'])(
    'shows a recovery action for unavailable %s without mounting its form',
    async (tab) => {
      const { settings, onClose, renderPage } = setup(tab);
      expect(screen.getByRole('status').textContent).toBe(
        'This settings section is unavailable.'
      );
      expect(renderPage).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Back to settings'));
      expect(settings.page()).toBeUndefined();
      expect(settings.open()).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy();
      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole('heading', { name: 'Settings' })
        );
      });
    }
  );

  it('renders available sections and reacts when availability changes', () => {
    const { setAvailableGroups } = setup('Account');
    expect(screen.getByText('Account form')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    setAvailableGroups([]);
    expect(screen.queryByText('Account form')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'This settings section is unavailable.'
    );
    setAvailableGroups(groups);
    expect(screen.getByText('Account form')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
