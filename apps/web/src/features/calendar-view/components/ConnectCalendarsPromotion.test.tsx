import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectCalendarsPromotion } from './ConnectCalendarsPromotion';

const host = vi.hoisted(() => ({
  accounts: [] as
    | {
        linkId: string;
        emailAddress: string;
        action: 'enable' | 'reconnect' | 'turnOff';
        consentScopes: string;
      }[]
    | undefined,
  startAddInbox: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { dismissed: [] },
  }),
  dismissPromptEverywhere: vi.fn(),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-accounts', () => ({
  useLoadedCalendarAccounts: () => () => host.accounts,
}));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => host.startAddInbox,
}));

const account = (
  emailAddress: string,
  action: 'enable' | 'reconnect' | 'turnOff'
) => ({
  linkId: emailAddress,
  emailAddress,
  action,
  consentScopes: 'calendar',
});

afterEach(() => {
  cleanup();
  host.accounts = [];
  host.startAddInbox.mockReset();
  localStorage.clear();
});

describe('ConnectCalendarsPromotion', () => {
  it('connects a new Google account with mail and calendar scopes', () => {
    host.accounts = [account('me@example.com', 'turnOff')];
    render(() => <ConnectCalendarsPromotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect a calendar' }));
    expect(host.startAddInbox).toHaveBeenCalledWith({
      scopes: 'gmail_and_calendar',
    });
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

  it('offers to reconnect an expired calendar grant', () => {
    host.accounts = [
      account('me@example.com', 'turnOff'),
      account('work@example.com', 'reconnect'),
    ];
    render(() => <ConnectCalendarsPromotion />);
    expect(
      screen.getByRole('button', { name: 'Reconnect calendar' })
    ).toBeTruthy();
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
