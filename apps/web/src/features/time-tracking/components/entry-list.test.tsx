import { formatLocale } from '@app/lib/i18n';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntryList, type EntryPerson } from './entry-list';

const PEOPLE: Record<string, string> = {
  ada: 'Ada Example',
  ben: 'Ben Example',
};

const person: EntryPerson = {
  avatar: (userId) => <span aria-hidden="true">{userId.slice(0, 1)}</span>,
  name: (userId) => PEOPLE[userId] ?? userId,
};

function entry(
  overrides: Partial<TimeEntryFieldsFragment>
): TimeEntryFieldsFragment {
  return {
    id: 'entry-1',
    taskId: 'task-1',
    userId: 'ada',
    date: '2026-11-24',
    minutes: 30,
    note: null,
    startedAt: null,
    endedAt: null,
    source: 'MANUAL',
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    canEdit: true,
    ...overrides,
  };
}

function renderList(entries: TimeEntryFieldsFragment[]) {
  render(() => (
    <EntryList
      entries={entries}
      today="2026-11-24"
      person={person}
      actions={(row) => (
        <button type="button" disabled={!row.canEdit}>
          Entry actions
        </button>
      )}
    />
  ));
}

/** The line a name heads: the name and what follows it. */
function nameLine(name: string): HTMLElement {
  const line = screen.getByText(name).parentElement;
  if (!line) throw new Error(`no line for ${name}`);
  return line;
}

beforeEach(() => {
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('puts how a timer entry was logged after the name and its note on a line of its own', () => {
  renderList([entry({ source: 'TIMER', note: 'Wireframes', minutes: 1 })]);

  const line = nameLine('Ada Example');
  expect(line.textContent).toBe('Ada Exampletimer');
  const note = screen.getByText('Wireframes');
  expect(line.contains(note)).toBe(false);
  expect(note.tagName).toBe('P');
});

it('follows the name with the span of an entry that has a start and end', () => {
  const startedAt = '2026-11-24T14:00:00.000Z';
  const endedAt = '2026-11-24T15:30:00.000Z';
  renderList([entry({ startedAt, endedAt, minutes: 90 })]);

  const range = new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(new Date(startedAt), new Date(endedAt));
  expect(nameLine('Ada Example').textContent).toBe(`Ada Example${range}`);
  expect(screen.getByText('1h 30m').textContent).toBe('1h 30m');
});

it('keeps an entry without a note or span to the name alone', () => {
  renderList([entry({ minutes: 15 })]);

  expect(nameLine('Ada Example').textContent).toBe('Ada Example');
  expect(document.querySelector('p')).toBeNull();
  expect(screen.getByText('15m').textContent).toBe('15m');
});

it('lists each person by name with their own note', () => {
  renderList([
    entry({ id: 'mine', note: 'Review' }),
    entry({ id: 'theirs', userId: 'ben', note: 'Sketches', canEdit: false }),
  ]);

  expect(nameLine('Ada Example').contains(screen.getByText('Review'))).toBe(
    false
  );
  expect(nameLine('Ben Example').contains(screen.getByText('Sketches'))).toBe(
    false
  );
});

it('folds a long note to its first lines and opens the rest with Show more', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(66);
  renderList([entry({ note: 'A long account of the work. '.repeat(20) })]);

  const more = screen.getByRole('button', { name: 'Show more' });
  expect(more.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(more);
  const less = screen.getByRole('button', { name: 'Show less' });
  expect(less.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(less);
  expect(
    screen
      .getByRole('button', { name: 'Show more' })
      .getAttribute('aria-expanded')
  ).toBe('false');
});

it('offers no Show more for a note that fits', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(22);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(22);
  renderList([entry({ note: 'Review' })]);

  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
});

it('keeps a note open when the list reads its entries again', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(66);
  const note = 'A long account of the work. '.repeat(20);
  const [entries, setEntries] = createSignal([entry({ note })]);
  render(() => (
    <EntryList entries={entries()} today="2026-11-24" person={person} />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  setEntries([
    entry({ note }),
    entry({ id: 'entry-2', userId: 'ben', minutes: 10 }),
  ]);

  expect(
    screen
      .getByRole('button', { name: 'Show less' })
      .getAttribute('aria-expanded')
  ).toBe('true');
  expect(screen.getByText('Ben Example').textContent).toBe('Ben Example');
});
