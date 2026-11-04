import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarPromotion } from './sidebar-promotion';

const server = vi.hoisted(() => ({
  status: 'success' as 'success' | 'pending' | 'error',
  dismissed: [] as string[],
  dismiss: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () => ({
    get isSuccess() {
      return server.status === 'success';
    },
    get isError() {
      return server.status === 'error';
    },
    get data() {
      return { dismissed: server.dismissed };
    },
  }),
  dismissPromptEverywhere: server.dismiss,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  server.status = 'success';
  server.dismissed = [];
  server.dismiss.mockClear();
});

const logos = [{ name: 'GitHub', icon: () => <svg /> }];

describe('SidebarPromotion', () => {
  it('runs both actions with their buttons and stays dismissed', () => {
    const action = vi.fn();
    const secondary = vi.fn();
    const view = render(() => (
      <SidebarPromotion
        id="test"
        applies
        logos={logos}
        headline="Set up"
        pitch="Do the thing."
        action={{ label: 'Connect tools', onClick: action }}
        secondaryAction={{ label: 'Invite team', onClick: secondary }}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Connect tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite team' }));
    expect(action).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    expect(secondary).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss connect tools' })
    );
    expect(screen.queryByText('Set up')).toBeNull();
    expect(server.dismiss).toHaveBeenCalledWith('test');
    view.unmount();
    render(() => (
      <SidebarPromotion
        id="test"
        applies
        logos={logos}
        headline="Set up"
        pitch="Do the thing."
        action={{ label: 'Connect tools', onClick: action }}
      />
    ));
    expect(screen.queryByText('Set up')).toBeNull();
  });

  it('hides while it does not apply without recording a dismissal', () => {
    const [applies, setApplies] = createSignal(false);
    render(() => (
      <SidebarPromotion
        id="satisfied"
        applies={applies()}
        logos={logos}
        headline="More calendars"
        pitch="Add one."
        action={{ label: 'Connect', onClick: () => {} }}
      />
    ));
    expect(screen.queryByText('More calendars')).toBeNull();
    setApplies(true);
    expect(screen.getByText('More calendars')).toBeTruthy();
    expect(server.dismiss).not.toHaveBeenCalled();
  });

  it('stays hidden when another device dismissed it', () => {
    server.dismissed = ['elsewhere'];
    render(() => (
      <SidebarPromotion
        id="elsewhere"
        applies
        logos={logos}
        headline="Dismissed elsewhere"
        pitch="Gone."
        action={{ label: 'Go', onClick: () => {} }}
      />
    ));
    expect(screen.queryByText('Dismissed elsewhere')).toBeNull();
  });

  it('waits for the server, then falls back to showing on error', () => {
    server.status = 'pending';
    const view = render(() => (
      <SidebarPromotion
        id="loading"
        applies
        logos={logos}
        headline="Loading card"
        pitch="Wait."
        action={{ label: 'Go', onClick: () => {} }}
      />
    ));
    expect(screen.queryByText('Loading card')).toBeNull();
    view.unmount();
    server.status = 'error';
    render(() => (
      <SidebarPromotion
        id="loading"
        applies
        logos={logos}
        headline="Loading card"
        pitch="Wait."
        action={{ label: 'Go', onClick: () => {} }}
      />
    ));
    expect(screen.getByText('Loading card')).toBeTruthy();
  });

  it('renders its last decision at once while inputs load', () => {
    const card = (applies: boolean | undefined) => (
      <SidebarPromotion
        id="remembered"
        applies={applies}
        logos={logos}
        headline="Remembered"
        pitch="Instant."
        action={{ label: 'Go', onClick: () => {} }}
      />
    );
    // Nothing known yet: stay hidden rather than guess.
    server.status = 'pending';
    let view = render(() => card(undefined));
    expect(screen.queryByText('Remembered')).toBeNull();
    view.unmount();
    // Settled as shown, then remounted while flags and dismissals load.
    server.status = 'success';
    view = render(() => card(true));
    expect(screen.getByText('Remembered')).toBeTruthy();
    view.unmount();
    server.status = 'pending';
    view = render(() => card(undefined));
    expect(screen.getByText('Remembered')).toBeTruthy();
    view.unmount();
    // Settled as hidden: a remount while loading must not flash it.
    server.status = 'success';
    server.dismissed = ['remembered'];
    view = render(() => card(true));
    expect(screen.queryByText('Remembered')).toBeNull();
    view.unmount();
    server.status = 'pending';
    render(() => card(undefined));
    expect(screen.queryByText('Remembered')).toBeNull();
  });
});
