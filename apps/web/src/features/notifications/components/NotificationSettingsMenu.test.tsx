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
import {
  type NotificationSettingsMenuProps,
  NotificationSettingsPage,
} from './NotificationSettingsMenu';

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

function setup(
  initial: readonly ChannelNotificationKind[],
  extra: Partial<NotificationSettingsMenuProps> = {}
) {
  const [kinds, setKinds] = createSignal<ChannelNotificationKind[]>([
    ...initial,
  ]);
  const onPreset = vi.fn((preset: Exclude<NotificationPreset, 'custom'>) =>
    setKinds([...PRESET_KINDS[preset]])
  );
  const onActionComplete = vi.fn();
  const onSetKinds = vi.fn((next: ReadonlySet<ChannelNotificationKind>) =>
    setKinds([...next])
  );
  const view = render(() => (
    <MobileDrawer open>
      <MobileDrawer.Portal>
        <MobileDrawer.Content aria-label="Channel actions">
          <NotificationSettingsPage
            preset={presetFor(new Set(kinds()))}
            enabled={new Set(kinds())}
            targetName="general"
            onPreset={onPreset}
            onSetKinds={onSetKinds}
            onBack={vi.fn()}
            onActionComplete={onActionComplete}
            {...extra}
          />
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  ));
  return { kinds, onPreset, onSetKinds, onActionComplete, view };
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

  it('offers the section default first, saying what it gives', () => {
    const onSelect = vi.fn();
    const page = setup(PRESET_KINDS.all, {
      sectionDefault: {
        description: 'Nothing · Engineering',
        onSelect,
      },
    });

    const row = screen.getByRole('button', { name: /Use section default/ });
    expect(row.textContent).toContain('Nothing · Engineering');
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(page.onActionComplete).toHaveBeenCalledOnce();
  });

  it('shows where an inheriting channel’s settings come from', () => {
    setup(PRESET_KINDS.all, {
      hint: 'Inherited from Engineering',
      source: 'Inherited from Engineering',
    });

    expect(screen.getByText('Inherited from Engineering')).toBeTruthy();
    expect(screen.queryByText('Use section default')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Custom settings…' }));
    expect(screen.getByText('Inherited from Engineering')).toBeTruthy();
  });

  it('saves a section’s custom kinds once, on leaving the page', () => {
    const page = setup(PRESET_KINDS.all, { saveCustomOnLeave: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Custom settings…' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Emoji reactions' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calls' }));
    expect(
      screen
        .getByRole('checkbox', { name: 'Calls' })
        .getAttribute('aria-checked')
    ).toBe('false');
    expect(page.onSetKinds).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(page.onSetKinds).toHaveBeenCalledOnce();
    expect(new Set(page.kinds())).toEqual(
      new Set([
        'channel_message_send',
        'channel_message_reply',
        'channel_mention',
        'channel_access_requested',
      ])
    );
  });

  it('saves a section’s custom kinds when the sheet closes on that page', async () => {
    const page = setup(PRESET_KINDS.all, { saveCustomOnLeave: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Custom settings…' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Calls' }));
    page.view.unmount();
    await Promise.resolve();

    expect(page.onSetKinds).toHaveBeenCalledOnce();
    expect(page.kinds()).not.toContain('call_started');
  });

  it('saves nothing on leaving when nothing changed', async () => {
    const page = setup(PRESET_KINDS.all, { saveCustomOnLeave: true });

    fireEvent.click(screen.getByRole('radio', { name: 'Custom settings…' }));
    page.view.unmount();
    await Promise.resolve();

    expect(page.onSetKinds).not.toHaveBeenCalled();
  });
});
