import type { SettingsTabItem } from '@core/constant/settingsTabsConfig';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSearch } from './SettingsSearch';
import {
  buildSettingsSearchIndex,
  type SettingsSearchEntry,
  searchSettings,
} from './settingsSearch';

const Icon = () => null;

const TABS: SettingsTabItem[] = [
  { tab: 'Account', label: 'Account', icon: Icon },
  { tab: 'Team', label: 'Team', icon: Icon },
  { tab: 'Connected', label: 'Connections', icon: Icon },
];

const INDEX = buildSettingsSearchIndex(TABS);

/** Mounts the search with a controlled query, the way the settings panel does. */
function setup(options: { initialQuery?: string } = {}) {
  const onSelect = vi.fn<(entry: SettingsSearchEntry) => void>();
  const onEscape = vi.fn();
  // Created inside render so the computations belong to the test's root and are
  // disposed with it.
  let query!: Accessor<string>;

  render(() => {
    const [q, setQuery] = createSignal(options.initialQuery ?? '');
    query = q;
    const results = createMemo(() => searchSettings(q(), INDEX));
    return (
      <SettingsSearch
        query={q()}
        onQueryChange={setQuery}
        results={results()}
        onSelect={onSelect}
        onEscape={onEscape}
      />
    );
  });

  const input = screen.getByLabelText('Search settings') as HTMLInputElement;
  const type = (value: string) => {
    input.value = value;
    fireEvent.input(input);
  };
  const press = (key: string) => fireEvent.keyDown(input, { key });

  return { input, type, press, query, onSelect, onEscape };
}

describe('SettingsSearch', () => {
  afterEach(cleanup);

  it('shows nothing but the field until something is typed', () => {
    setup();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('lists matches with a breadcrumb for inner items', () => {
    const { type } = setup();
    type('gmail');

    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('Gmail');
    expect(options[0]?.textContent).toContain('Connections · Accounts');
  });

  it('lists a page match without a breadcrumb', () => {
    const { type } = setup();
    type('team');

    const [first] = screen.getAllByRole('option');
    expect(first?.textContent).toBe('Team');
  });

  it('explains when nothing matches', () => {
    const { type } = setup();
    type('zzzz');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('No settings match “zzzz”')).toBeTruthy();
  });

  it('opens the highlighted result on Enter and clears the query', () => {
    const { type, press, query, onSelect } = setup();
    type('team');
    press('ArrowDown');
    press('Enter');

    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0]?.[0];
    expect(picked?.tab).toBe('Team');
    expect(picked?.isPage).toBe(false);
    expect(query()).toBe('');
  });

  it('opens a result on click', () => {
    const { type, onSelect } = setup();
    type('gmail');
    fireEvent.click(screen.getAllByRole('option')[0]!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.title).toBe('Gmail');
  });

  it('keeps the highlight inside the result list', () => {
    const { type, press } = setup();
    type('gmail');
    const count = screen.getAllByRole('option').length;

    for (let i = 0; i < count + 3; i++) press('ArrowDown');
    expect(
      screen.getAllByRole('option').at(-1)?.getAttribute('aria-selected')
    ).toBe('true');

    for (let i = 0; i < count + 3; i++) press('ArrowUp');
    expect(
      screen.getAllByRole('option')[0]?.getAttribute('aria-selected')
    ).toBe('true');
  });

  it('clears the query on Escape, and only closes once it is already empty', () => {
    const { type, press, query, onEscape } = setup();
    type('team');
    press('Escape');

    expect(query()).toBe('');
    expect(onEscape).not.toHaveBeenCalled();

    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('clears the query from the clear button', () => {
    const { type, query } = setup();
    type('team');
    fireEvent.click(screen.getByLabelText('Clear search'));

    expect(query()).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
