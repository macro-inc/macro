// @vitest-environment jsdom
import type { HotkeyInterceptorContext } from '@core/hotkey/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarCreateMenu } from './calendar-create-menu';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  failure: vi.fn(),
  intercept:
    vi.fn<(callback: (context: HotkeyInterceptorContext) => boolean) => void>(),
}));
vi.mock('@app/signal/hotkeyRoot', () => ({
  useHotkeyInterceptor: mocks.intercept,
}));
vi.mock('@queries/call/meetings', () => ({
  useCreateMeetingMutation: () => ({ mutateAsync: mocks.create }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));

async function choose(name: RegExp) {
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Create' }), {
      key: 'Enter',
    });
  }
  const item = await screen.findByRole('menuitem', { name });
  fireEvent.keyDown(item, { key: 'Enter' });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mocks.create.mockResolvedValue({ shareToken: 'new-call-token' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Calendar Create menu', () => {
  it.each(['e', 'q', 's'] as const)(
    'runs the %s shortcut only while the menu is open',
    async (key) => {
      const onEvent = vi.fn();
      const onScheduledCall = vi.fn();
      render(() => (
        <CalendarCreateMenu
          onEvent={onEvent}
          onScheduledCall={onScheduledCall}
        />
      ));
      const handle = mocks.intercept.mock.calls[0][0];
      const context: HotkeyInterceptorContext = {
        pressedKeysString: key,
        pressedKeys: new Set([key]),
        event: new KeyboardEvent('keydown', { key }),
        activeScopeId: 'command-scope-create-menu',
        isEditableFocused: false,
        eventType: 'keydown',
      };
      expect(handle(context)).toBe(false);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Create' }), {
        key: 'Enter',
      });
      await screen.findByRole('menu');
      expect(
        screen
          .getAllByRole('menuitem')
          .map((item) => item.getAttribute('aria-keyshortcuts'))
      ).toEqual(['E', 'Q', 'S']);
      expect(handle({ ...context, isEditableFocused: true })).toBe(false);
      expect(handle({ ...context, eventType: 'keyup' })).toBe(false);
      expect(handle(context)).toBe(true);
      expect(handle(context)).toBe(false);
      expect(onEvent).toHaveBeenCalledTimes(key === 'e' ? 1 : 0);
      expect(onScheduledCall).toHaveBeenCalledTimes(key === 's' ? 1 : 0);
      expect(mocks.create).toHaveBeenCalledTimes(key === 'q' ? 1 : 0);
    }
  );

  it('opens the event composer without creating a call', async () => {
    const onEvent = vi.fn();
    render(() => (
      <CalendarCreateMenu onEvent={onEvent} onScheduledCall={vi.fn()} />
    ));
    await choose(/^Event/);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates an instant link and enters its call', async () => {
    render(() => (
      <CalendarCreateMenu onEvent={vi.fn()} onScheduledCall={vi.fn()} />
    ));
    await choose(/^Quick Call/);
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        '/meet/new-call-token?start=true'
      )
    );
    expect(mocks.create).toHaveBeenCalledWith({ title: 'Quick Call' });
  });

  it('opens the scheduled event composer without creating a call yet', async () => {
    const onEvent = vi.fn();
    const onScheduledCall = vi.fn();
    render(() => (
      <CalendarCreateMenu onEvent={onEvent} onScheduledCall={onScheduledCall} />
    ));
    await choose(/^Scheduled Call/);
    expect(onScheduledCall).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('allows retrying a failed Quick Call', async () => {
    mocks.create.mockRejectedValueOnce(new Error('offline'));
    render(() => (
      <CalendarCreateMenu onEvent={vi.fn()} onScheduledCall={vi.fn()} />
    ));
    await choose(/^Quick Call/);
    await vi.waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
    await choose(/^Quick Call/);
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
