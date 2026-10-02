import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvitationResolution } from '../core/calendar-invitation';
import {
  invitationFixture,
  invitationFixtures,
} from '../core/calendar-invitation-fixtures';
import { CalendarInviteCard } from './calendar-invite-card';

vi.mock('@ui', async () => ({
  ...(await vi.importActual('@app/components/ui/components/Avatar')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
afterEach(cleanup);
const resolved: InvitationResolution = {
  kind: 'resolved',
  eventId: 'event',
  occurrenceKey: '2026-09-24T17:00:00Z',
  recurring: false,
  response: 'accepted',
  respondingEmail: 'you@example.com',
  canRespond: true,
  canJoin: true,
  isCancelled: false,
  isNewer: false,
  isStale: false,
  current: invitationFixture,
};

describe('native invitation card', () => {
  it('keeps focus and selected response through pending and failed updates', () => {
    const [state, setState] = createSignal(resolved);
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal<string>();
    render(() => (
      <CalendarInviteCard
        invitation={invitationFixture}
        actions={{
          get resolution() {
            return state();
          },
          get pending() {
            return pending();
          },
          get error() {
            return error();
          },
          respond: (value) => {
            setState({ ...resolved, response: value });
            setPending(true);
          },
        }}
      />
    ));
    const yes = screen.getByRole('button', { name: 'Yes' });
    const maybe = screen.getByRole('button', { name: 'Maybe' });
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    maybe.focus();
    fireEvent.click(maybe);
    expect(screen.getByRole('button', { name: 'Maybe' })).toBe(maybe);
    expect(document.activeElement).toBe(maybe);
    expect(maybe.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Saving');
    setPending(false);
    setError('Could not save. Please try again.');
    setState(resolved);
    expect(document.activeElement).toBe(maybe);
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('try again');
  });
  it.each(['cancelled', 'reply', 'counter'] as const)(
    'never offers RSVP or Join for %s',
    (name) => {
      render(() => (
        <CalendarInviteCard
          invitation={invitationFixtures[name]}
          actions={{
            resolution: resolved,
            respond: vi.fn(),
            openExternal: vi.fn(),
          }}
        />
      ));
      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Join meeting/ })).toBeNull();
    }
  );
  it('preserves the proposed time after resolving the existing event', () => {
    const proposal = {
      ...invitationFixture,
      method: 'counter' as const,
      start: {
        kind: 'zoned' as const,
        value: '2026-09-25T17:00:00Z',
        time_zone: 'America/Los_Angeles',
      },
    };
    render(() => (
      <CalendarInviteCard
        invitation={proposal}
        timeZone="America/Los_Angeles"
        actions={{ resolution: resolved }}
      />
    ));
    expect(screen.getByText(/Fri, Sep 25/)).toBeTruthy();
  });
  it('suppresses actions when a newer saved cancellation has no calendar occurrence', () => {
    render(() => (
      <CalendarInviteCard
        invitation={invitationFixture}
        actions={{
          resolution: { kind: 'cancelled' },
          respond: vi.fn(),
          openExternal: vi.fn(),
        }}
      />
    ));
    expect(
      screen.queryByRole('button', { name: /Join meeting|Yes/ })
    ).toBeNull();
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
  });
  it('expands guest identities and descriptions explicitly', () => {
    render(() => <CalendarInviteCard invitation={invitationFixture} />);
    fireEvent.click(screen.getByRole('button', { name: '+3 more' }));
    expect(screen.getByText(/Riley, Morgan, Taylor/)).toBeTruthy();
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(
      screen
        .getByRole('button', { name: 'Show less' })
        .getAttribute('aria-expanded')
    ).toBe('true');
  });
  it('withholds stale actions without hiding saved event details', () => {
    render(() => (
      <CalendarInviteCard
        invitation={invitationFixture}
        actions={{
          // The calendar never grants a response for a stale copy.
          resolution: {
            ...resolved,
            isStale: true,
            canRespond: false,
            canJoin: false,
          },
          respond: vi.fn(),
        }}
      />
    ));
    expect(
      screen.getByRole('heading', { name: 'Product review' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
    expect(screen.getByText(/Responses are paused/)).toBeTruthy();
  });
  it('renders HTML descriptions safely', () => {
    const htmlInvitation = {
      ...invitationFixture,
      description:
        '<p>Meeting details with <strong>bold</strong> and <a href="https://example.com">link</a></p><ul><li>First item</li><li>Second item</li></ul>',
    };
    render(() => <CalendarInviteCard invitation={htmlInvitation} />);
    const description = screen.getByText(/Meeting details/);
    // HTML should be rendered, not shown as raw text
    expect(description.innerHTML).toContain('<strong>');
    expect(description.innerHTML).toContain('<a');
    expect(description.innerHTML).toContain('<ul');
    // Text content should not contain raw HTML tags
    expect(description.textContent).not.toContain('<strong>');
  });
  it('escapes angle brackets in plain text descriptions', () => {
    const plainTextInvitation = {
      ...invitationFixture,
      description: 'Email <bob@example.com> for questions',
    };
    render(() => <CalendarInviteCard invitation={plainTextInvitation} />);
    const description = screen.getByText(/Email/);
    // Angle brackets should be visible as text
    expect(description.textContent).toContain('<bob@example.com>');
    // But not as actual HTML tags
    expect(description.querySelector('bob')).toBeNull();
  });
});
