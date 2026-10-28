import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSearch } from './database-search';

afterEach(cleanup);

describe('database search', () => {
  it('lists matches by table, moves through them with the arrow keys and opens one with Enter', () => {
    const choose = vi.fn();
    const close = vi.fn();
    render(() => (
      <DatabaseSearch
        term="ada"
        isOpen
        results={{
          status: 'ready',
          groups: [
            {
              tableId: 'parties',
              tableName: 'Parties',
              matches: [{ rowId: 'party-1', title: 'Ada’s birthday' }],
              more: 0,
            },
            {
              tableId: 'invites',
              tableName: 'Invites',
              matches: [
                {
                  rowId: 'invite-1',
                  title: 'Grace Hopper',
                  excerpt: {
                    columnName: 'Notes',
                    before: 'bring ',
                    match: 'Ada',
                    after: '’s notes',
                  },
                },
              ],
              more: 3,
            },
          ],
        }}
        onTermChange={vi.fn()}
        onOpen={vi.fn()}
        onClose={close}
        inputRef={vi.fn()}
        onChoose={choose}
      />
    ));
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['Ada’s birthday', 'Grace HopperNotes: bring Ada’s notes']);
    expect(screen.getByText('Ada', { selector: 'mark' })).toBeTruthy();
    expect(screen.getByText('3 more in Invites')).toBeTruthy();
    const input = screen.getByRole('combobox', { name: 'Search every table' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(close).toHaveBeenCalledExactlyOnceWith(false);
    expect(choose).toHaveBeenCalledExactlyOnceWith({
      tableId: 'invites',
      rowId: 'invite-1',
    });
  });

  it('closes on Escape, returning focus to where the search was opened from', () => {
    const close = vi.fn();
    render(() => (
      <DatabaseSearch
        term=""
        isOpen
        results={{ status: 'idle' }}
        onTermChange={vi.fn()}
        onOpen={vi.fn()}
        onClose={close}
        inputRef={vi.fn()}
        onChoose={vi.fn()}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('combobox', { name: 'Search every table' }),
      { key: 'Escape' }
    );
    expect(close).toHaveBeenCalledExactlyOnceWith(true);
  });
});
