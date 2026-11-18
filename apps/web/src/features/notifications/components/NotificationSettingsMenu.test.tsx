import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type NotificationPreset,
  PRESET_KINDS,
  presetFor,
} from '../core/channel-notification-settings';
import { NotificationSettingsPage } from './NotificationSettingsMenu';

// This project builds without the SVG plugin, so icons render as nothing.
vi.mock('@icon/system/regular/arrow-left.svg', () => ({ default: () => null }));
vi.mock('@icon/system/regular/bell.svg', () => ({ default: () => null }));
vi.mock('@icon/system/regular/check.svg', () => ({ default: () => null }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(initial: readonly ChannelNotificationKind[]) {
  const [kinds, setKinds] = createSignal<ChannelNotificationKind[]>([
    ...initial,
  ]);
  const onPreset = vi.fn((preset: Exclude<NotificationPreset, 'custom'>) =>
    setKinds([...PRESET_KINDS[preset]])
  );
  const onActionComplete = vi.fn();
  render(() => (
    <MobileDrawer open>
      <MobileDrawer.Portal>
        <MobileDrawer.Content aria-label="Channel actions">
          <NotificationSettingsPage
            preset={presetFor(new Set(kinds()))}
            enabled={new Set(kinds())}
            targetName="general"
            onPreset={onPreset}
            onSetKinds={(next) => setKinds([...next])}
            onBack={vi.fn()}
            onActionComplete={onActionComplete}
          />
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  ));
  return { kinds, onPreset, onActionComplete };
}

describe('phone notification settings page', () => {
  it('applies a preset and closes', () => {
    const page = setup(PRESET_KINDS.all);

    fireEvent.click(
      screen.getByRole('radio', { name: 'Messages involving me' })
    );

    expect(page.onPreset).toHaveBeenCalledWith('involving');
    expect(page.onActionComplete).toHaveBeenCalledOnce();
  });

  it('drills into custom settings, where each kind toggles in place', () => {
    const page = setup(PRESET_KINDS.involving);
    expect(
      screen
        .getByRole('radio', { name: 'Messages involving me' })
        .getAttribute('aria-checked')
    ).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Custom settings…' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Emoji reactions' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calls' }));

    expect(new Set(page.kinds())).toEqual(
      new Set([
        'channel_message_reply',
        'channel_mention',
        'channel_access_requested',
        'channel_message_reaction',
      ])
    );
    expect(
      screen
        .getByRole('checkbox', { name: 'Emoji reactions' })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(page.onActionComplete).not.toHaveBeenCalled();
  });
});
