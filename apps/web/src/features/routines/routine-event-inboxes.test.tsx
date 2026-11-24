import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InboxScopeLabel,
  RoutineInboxesLabel,
  RoutineInboxPicker,
} from './routine-event-inboxes';

const MINE = '01900000-0000-7000-8000-0000000000a1';
const TEAM = '01900000-0000-7000-8000-0000000000a2';
const GONE = '01900000-0000-7000-8000-0000000000a3';
const ME = 'macro|me@example.com';

type LinksQuery = {
  isPending: boolean;
  isError: boolean;
  data?: { links: { id: string; email_address: string; macro_id: string }[] };
};

const links = vi.hoisted(() => ({ query: {} as LinksQuery }));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => links.query,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => ME }));

const LISTED: LinksQuery['data'] = {
  links: [
    { id: MINE, email_address: 'me@example.com', macro_id: ME },
    {
      id: TEAM,
      email_address: 'team@example.com',
      macro_id: 'macro|team@example.com',
    },
  ],
};

function renderPicker(initial: string[]) {
  const [picked, setPicked] = createSignal(initial);
  render(() => <RoutineInboxPicker inboxes={picked} onChange={setPicked} />);
  return picked;
}

beforeEach(() => {
  links.query = { isPending: false, isError: false, data: LISTED };
});

describe('the inbox picker', () => {
  it('lists the person’s inboxes and those shared with them to check', () => {
    const picked = renderPicker([]);
    expect(screen.getByText('Shared with you')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /^team@example\.com/ })
    );
    expect(picked()).toEqual([TEAM]);
    expect(
      screen.getByText('Runs only for mail into the inboxes checked.')
    ).toBeTruthy();
  });

  it('keeps an inbox picked before it was disconnected, to uncheck', () => {
    const picked = renderPicker([GONE]);
    const gone = screen.getByRole('checkbox', { name: 'A disconnected inbox' });
    expect((gone as HTMLInputElement).checked).toBe(true);
    fireEvent.click(gone);
    expect(picked()).toEqual([]);
  });

  it('keeps a row mounted and focused when a refetch returns new objects', () => {
    const [data, setData] = createSignal(LISTED);
    links.query = {
      isPending: false,
      isError: false,
      get data() {
        return data();
      },
    };
    renderPicker([]);
    const team = screen.getByRole('checkbox', { name: /^team@example\.com/ });
    team.focus();
    setData({ links: (LISTED?.links ?? []).map((link) => ({ ...link })) });
    expect(screen.getByRole('checkbox', { name: /^team@example\.com/ })).toBe(
      team
    );
    expect(document.activeElement).toBe(team);
  });

  it('keeps the inboxes on screen when a refetch fails', () => {
    links.query = { isPending: false, isError: true, data: LISTED };
    renderPicker([]);
    expect(
      screen.getByRole('checkbox', { name: /^me@example\.com/ })
    ).toBeTruthy();
    expect(screen.queryByText('Your inboxes couldn’t be listed.')).toBeNull();
  });

  it('says so when the inboxes can’t be listed at all', () => {
    links.query = { isPending: false, isError: true };
    renderPicker([]);
    expect(screen.getByText('Your inboxes couldn’t be listed.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows a placeholder while the inboxes load', () => {
    links.query = { isPending: true, isError: false };
    renderPicker([]);
    expect(
      screen.getByRole('status', { name: 'Loading inboxes' })
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says when the person has no inboxes', () => {
    links.query = { isPending: false, isError: false, data: { links: [] } };
    renderPicker([]);
    expect(screen.getByText('You have no inboxes connected.')).toBeTruthy();
  });
});

describe('the picked inboxes’ label', () => {
  it('names one inbox, counts several, and says when one is gone', () => {
    render(() => (
      <>
        <RoutineInboxesLabel inboxes={[TEAM]} />
        <RoutineInboxesLabel inboxes={[MINE, TEAM]} />
        <RoutineInboxesLabel inboxes={[GONE]} />
      </>
    ));
    expect(screen.getByText('team@example.com')).toBeTruthy();
    expect(screen.getByText('2 inboxes')).toBeTruthy();
    expect(screen.getByText('A disconnected inbox')).toBeTruthy();
  });

  it('counts the inbox while the list loads', () => {
    links.query = { isPending: true, isError: false };
    render(() => <RoutineInboxesLabel inboxes={[TEAM]} />);
    expect(screen.getByText('1 inbox')).toBeTruthy();
  });
});

describe('the email trigger’s scope', () => {
  it('reads Your inboxes only once the person reads more than one', () => {
    const scope = (listed: LinksQuery) => {
      links.query = listed;
      const { container, unmount } = render(() => <InboxScopeLabel />);
      const text = container.textContent;
      unmount();
      return text;
    };
    expect(scope({ isPending: false, isError: false, data: LISTED })).toBe(
      'Your inboxes'
    );
    expect(
      scope({
        isPending: false,
        isError: false,
        data: { links: LISTED?.links.slice(0, 1) ?? [] },
      })
    ).toBe('Your inbox');
    expect(
      scope({ isPending: false, isError: false, data: { links: [] } })
    ).toBe('Your inbox');
    expect(scope({ isPending: true, isError: false })).toBe('Your inbox');
  });
});
