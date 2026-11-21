import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectCalendarsPromotion } from './ConnectCalendarsPromotion';

const host = vi.hoisted(() => ({
  accounts: [] as
    | {
        linkId: string;
        emailAddress: string;
        action: 'enable' | 'reconnect' | 'turnOff';
        stoppedSyncing: boolean;
        consentScopes: string;
      }[]
    | undefined,
  dismissed: [] as string[],
  dismissalsLoaded: true,
  /** Tells the accounts accessor that `accounts` changed. */
  bump: () => {},
  startAddInbox: vi.fn(),
  outlookOffered: false,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () =>
    host.dismissalsLoaded
      ? { isSuccess: true, isError: false, data: { dismissed: host.dismissed } }
      : { isSuccess: false, isError: false, data: undefined },
  dismissPromptEverywhere: vi.fn(),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-accounts', async () => {
  const { createSignal } = await import('solid-js');
  const [version, setVersion] = createSignal(0);
  host.bump = () => setVersion((v) => v + 1);
  return {
    useLoadedCalendarAccounts: () => () => {
      version();
      return host.accounts;
    },
  };
});
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => host.startAddInbox,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  useOutlookAvailable: (enabled: () => boolean) => () =>
    enabled() && host.outlookOffered,
}));

const account = (
  emailAddress: string,
  action: 'enable' | 'reconnect' | 'turnOff',
  stoppedSyncing = false
) => ({
  linkId: emailAddress,
  emailAddress,
  action,
  stoppedSyncing,
  consentScopes: 'calendar',
});

afterEach(() => {
  cleanup();
  host.accounts = [];
  host.dismissed = [];
  host.dismissalsLoaded = true;
  host.startAddInbox.mockReset();
  host.outlookOffered = false;
  localStorage.clear();
});

describe('ConnectCalendarsPromotion', () => {
  it('connects a new account with mail and calendar scopes', () => {
    host.accounts = [account('me@example.com', 'turnOff')];
    render(() => <ConnectCalendarsPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect a calendar' }));
    expect(host.startAddInbox).toHaveBeenCalledWith({
      scopes: 'gmail_and_calendar',
    });
  });

  it('invites another account without naming a provider', () => {
    host.accounts = [account('me@example.com', 'turnOff')];
    const view = render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByText(
        'Add another account to see your work and personal calendars together.'
      )
    ).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/Google|Outlook|Microsoft/);
  });

  it('shows the Outlook logo only while Outlook is offered', () => {
    host.accounts = [account('me@example.com', 'turnOff')];
    const view = render(() => <ConnectCalendarsPromotion />);
    expect(screen.getByRole('list', { name: 'Google Calendar' })).toBeTruthy();
    view.unmount();
    host.outlookOffered = true;
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('list', { name: 'Google Calendar, Outlook' })
    ).toBeTruthy();
  });

  it('turns on calendar for a connected account before adding another', () => {
    host.accounts = [account('me@example.com', 'enable')];
    render(() => <ConnectCalendarsPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on calendar' }));
    expect(host.startAddInbox).toHaveBeenCalledWith({
      scopes: 'calendar',
      emailAddress: 'me@example.com',
    });
  });

  it('says which account to turn calendar on for', () => {
    host.accounts = [account('me@example.com', 'enable')];
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('heading', { name: 'Enable calendar' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Grant calendar access for me@example.com to turn it on.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Connect more calendars')).toBeNull();
  });

  it('offers to reconnect an expired calendar grant', () => {
    host.accounts = [
      account('me@example.com', 'turnOff'),
      account('work@example.com', 'reconnect'),
    ];
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('heading', { name: 'Reconnect calendar' })
    ).toBeTruthy();
    expect(
      screen.getByText('Reconnect work@example.com to resume calendar sync.')
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reconnect calendar' })
    ).toBeTruthy();
  });

  it('says a calendar stopped syncing, past an older dismissal of the card', () => {
    host.dismissed = ['calendar-accounts'];
    host.accounts = [
      account('me@example.com', 'turnOff'),
      account('work@example.com', 'reconnect', true),
    ];
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('heading', { name: 'Calendar stopped syncing' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Reconnect work@example.com to show its events in Macro again.'
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect calendar' }));
    expect(host.startAddInbox).toHaveBeenCalledWith({
      scopes: 'calendar',
      emailAddress: 'work@example.com',
    });
    expect(
      screen.getByRole('button', { name: 'Dismiss calendar stopped syncing' })
    ).toBeTruthy();
  });

  it('shows a calendar that stopped syncing at once after a reload', () => {
    host.accounts = [account('work@example.com', 'enable')];
    const view = render(() => <ConnectCalendarsPromotion />);
    host.accounts = [account('work@example.com', 'reconnect', true)];
    host.bump();
    expect(
      screen.getByRole('heading', { name: 'Calendar stopped syncing' })
    ).toBeTruthy();
    view.unmount();
    // Reload: links and dismissals still loading.
    host.accounts = undefined;
    host.dismissalsLoaded = false;
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('heading', { name: 'Calendar stopped syncing' })
    ).toBeTruthy();
  });

  it('keeps an older dismissal for the other cases', () => {
    host.dismissed = ['calendar-accounts'];
    host.accounts = [account('me@example.com', 'enable')];
    render(() => <ConnectCalendarsPromotion />);
    expect(screen.queryByText('Enable calendar')).toBeNull();
  });

  it('hides once two accounts have calendar access', () => {
    host.accounts = [
      account('me@example.com', 'turnOff'),
      account('work@example.com', 'turnOff'),
    ];
    render(() => <ConnectCalendarsPromotion />);
    expect(screen.queryByText('Connect more calendars')).toBeNull();
  });

  it('renders the last known button at once while accounts load', () => {
    host.accounts = [account('me@example.com', 'enable')];
    const view = render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('button', { name: 'Turn on calendar' })
    ).toBeTruthy();
    view.unmount();
    host.accounts = undefined;
    render(() => <ConnectCalendarsPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on calendar' }));
    expect(host.startAddInbox).toHaveBeenCalledWith({
      scopes: 'calendar',
      emailAddress: 'me@example.com',
    });
  });

  it('shows nothing while accounts load on a first visit', () => {
    host.accounts = undefined;
    render(() => <ConnectCalendarsPromotion />);
    expect(screen.queryByText('Connect more calendars')).toBeNull();
  });
});
