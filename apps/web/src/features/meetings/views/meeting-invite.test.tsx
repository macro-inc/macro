// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  MeetingInvitePerson,
  MeetingTeammatesSource,
} from '../context/meeting-invite';
import { MeetingInvite } from './meeting-invite';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: {
    id: string;
    suppressClick?: boolean;
    showTooltip?: boolean;
  }) => (
    <span
      data-user-id={props.id}
      data-suppress-click={props.suppressClick}
      data-show-tooltip={props.showTooltip}
    />
  ),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'viewer@example.com',
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/user', () => ({
  emailToId: (email: string) => `macro|${email}`,
  useAugmentUserWithDmActivity: () => (user: MeetingInvitePerson) => user,
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () => [
        {
          kind: 'user',
          id: 'macro|outside@example.com',
          data: {
            id: 'macro|outside@example.com',
            email: 'outside@example.com',
            name: 'Outside Contact',
          },
        },
      ],
    }),
    isLoading: () => false,
  }),
}));
vi.mock('@entity', () => ({
  createEmailsInfiniteQuery: () => ({
    data: [],
    isLoading: false,
    isPending: false,
  }),
  Entity: { Icon: () => <span />, Title: () => <span /> },
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({
    status: 'success',
    data: [],
    isFetching: false,
  }),
}));
vi.mock('@property/utils', async () => import('../../property/utils/focus'));

const people = [
  { id: 'macro|b@example.com', email: 'b@example.com', name: 'Brianna Bell' },
  { id: 'macro|c@example.com', email: 'c@example.com', name: 'Camille Chen' },
];

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(roster: MeetingInvitePerson[] = people) {
  const source: MeetingTeammatesSource = {
    people: () => roster,
    loading: () => false,
    error: () => undefined,
    refresh: vi.fn(),
  };
  const [selected, setSelected] = createSignal(new Set<string>());
  const select = vi.fn((ids: Set<string>) => setSelected(ids));
  render(() => (
    <MeetingInvite source={source} selected={selected} setSelected={select} />
  ));
  const trigger = screen.getByRole('button', { name: 'Invite Teammates' });
  fireEvent.click(trigger);
  return { selected, setSelected, select, trigger };
}

async function selectByName(name: string) {
  const input = screen.getByPlaceholderText('Search teammates…');
  fireEvent.input(input, { target: { value: name } });
  await vi.waitFor(() => {
    const rows = document.querySelectorAll('[data-entity-index]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(name);
  });
  input.focus();
  await userEvent.keyboard('{Enter}');
}

function checkboxFor(name: string) {
  const row = screen.getByText(name).closest('[data-entity-index]');
  if (!row) throw new Error(`Missing teammate row for ${name}`);
  const checkbox = row.querySelector<HTMLInputElement>(
    'input[type="checkbox"]'
  );
  if (!checkbox) throw new Error(`Missing teammate checkbox for ${name}`);
  return checkbox;
}

it('searches names and keeps multiple selections controlled without an invitation action', async () => {
  const { selected, select, trigger } = setup();
  expect(trigger.getAttribute('data-size')).toBe('lg');
  expect(trigger.classList.contains('w-full')).toBe(true);
  expect(screen.queryByText('Outside Contact')).toBeNull();

  await selectByName('Brianna Bell');
  await selectByName('Camille Chen');
  expect([...selected()]).toEqual(people.map((person) => person.id));
  expect(select).toHaveBeenCalledTimes(2);
  expect(checkboxFor('Brianna Bell').checked).toBe(true);
  expect(checkboxFor('Camille Chen').checked).toBe(true);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const dropdown = screen.getByRole('dialog', { name: 'Invite teammates' });
  expect(within(dropdown).queryAllByRole('button')).toEqual([]);
  expect(screen.queryByText('Rings them in Macro')).toBeNull();
  expect(screen.queryByText('Invites sent')).toBeNull();
});

it('reflects parent selection changes and permits deselecting a teammate', () => {
  const { selected, setSelected, select } = setup();
  setSelected(new Set(people.map((person) => person.id)));
  expect(checkboxFor('Brianna Bell').checked).toBe(true);
  expect(checkboxFor('Camille Chen').checked).toBe(true);
  expect(select).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('Brianna Bell'));
  expect([...selected()]).toEqual([people[1].id]);
  expect(checkboxFor('Brianna Bell').checked).toBe(false);
  expect(checkboxFor('Camille Chen').checked).toBe(true);
});

it('does not add arbitrary email addresses outside the teammate roster', async () => {
  const { selected, select } = setup();
  fireEvent.input(screen.getByPlaceholderText('Search teammates…'), {
    target: { value: 'outsider@external.example' },
  });
  await vi.waitFor(() =>
    expect(screen.getByText('No users found')).toBeTruthy()
  );
  fireEvent.keyDown(screen.getByPlaceholderText('Search teammates…'), {
    key: 'Enter',
  });
  expect(selected().size).toBe(0);
  expect(select).not.toHaveBeenCalled();
});

it('preserves selections on Escape and stops handling keys once the picker closes', async () => {
  const user = userEvent.setup();
  const { selected, select, trigger } = setup();
  await selectByName('Brianna Bell');
  screen.getByPlaceholderText('Search teammates…').focus();
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.keyDown(document, { key: 'Enter' });
  expect([...selected()]).toEqual([people[0].id]);
  expect(select).toHaveBeenCalledTimes(1);
  expect(trigger.textContent).toContain('1 teammate');
  expect(trigger.getAttribute('aria-label')).toBe(
    'Invite Teammates, 1 selected: Brianna Bell'
  );
  expect(
    trigger.querySelector('[data-user-id]')?.getAttribute('data-user-id')
  ).toBe(people[0].id);

  fireEvent.click(trigger);
  expect(checkboxFor('Brianna Bell').checked).toBe(true);
});

it('shows stacked avatars and the full selected count after closing, then restores the empty button', async () => {
  const { selected, setSelected, select, trigger } = setup();
  await selectByName('Brianna Bell');
  await selectByName('Camille Chen');
  await userEvent.keyboard('{Escape}');

  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(trigger.textContent).toContain('2 teammates');
  expect(trigger.getAttribute('aria-label')).toBe(
    'Invite Teammates, 2 selected: Brianna Bell, Camille Chen'
  );
  const stack = trigger.querySelector('[data-slot="avatar-group"]');
  expect(stack?.getAttribute('data-size')).toBe('md');
  expect(
    [...(stack?.querySelectorAll('[data-user-id]') ?? [])].map((avatar) => ({
      id: avatar.getAttribute('data-user-id'),
      suppressClick: avatar.getAttribute('data-suppress-click'),
      showTooltip: avatar.getAttribute('data-show-tooltip'),
    }))
  ).toEqual(
    people.map((person) => ({
      id: person.id,
      suppressClick: 'true',
      showTooltip: 'false',
    }))
  );
  expect(trigger.getAttribute('data-size')).toBe('lg');
  expect(trigger.classList.contains('bg-hover')).toBe(true);
  expect(trigger.classList.contains('w-full')).toBe(true);
  expect(selected().size).toBe(2);
  expect(select).toHaveBeenCalledTimes(2);

  setSelected(new Set<string>());
  expect(trigger.textContent).toContain('Invite Teammates');
  expect(trigger.querySelector('[data-slot="avatar-group"]')).toBeNull();
  expect(trigger.getAttribute('aria-label')).toBe('Invite Teammates');
  expect(select).toHaveBeenCalledTimes(2);
});

it('limits visible avatars while counting all selected teammates', async () => {
  const roster = [
    ...people,
    { id: 'macro|d@example.com', email: 'd@example.com', name: 'Dana Davis' },
    { id: 'macro|e@example.com', email: 'e@example.com', name: 'Evan Ellis' },
  ];
  const { setSelected, trigger } = setup(roster);
  setSelected(new Set(roster.map((person) => person.id)));
  await userEvent.keyboard('{Escape}');

  expect(trigger.querySelectorAll('[data-user-id]')).toHaveLength(3);
  expect(trigger.textContent).toContain('4 teammates');
  expect(trigger.getAttribute('aria-label')).toContain(
    'Dana Davis, Evan Ellis'
  );
  fireEvent.click(trigger);
  for (const person of roster)
    expect(checkboxFor(person.name).checked).toBe(true);
});
