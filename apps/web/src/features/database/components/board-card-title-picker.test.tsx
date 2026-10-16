import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Dropdown } from '@ui/components/Dropdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardCardTitlePicker } from './board-card-title-picker';

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  menuStyles = document.createElement('style');
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
});

describe('board card title picker', () => {
  it('lists every column, checks the title, and retitles the board', async () => {
    const change = vi.fn();
    render(() => (
      <Dropdown>
        <Dropdown.Trigger aria-label="Board menu">Menu</Dropdown.Trigger>
        <Dropdown.Content>
          <BoardCardTitlePicker
            layout={{
              kind: 'board',
              groupBy: 'status',
              title: 'name',
              lanes: [
                { key: { kind: 'option', id: 'option-done' }, hidden: true },
              ],
              cardFields: ['owner'],
              hideEmptyLanes: true,
            }}
            columns={[
              {
                id: 'name',
                name: 'Name',
                dataType: 'STRING',
                isMultiSelect: false,
                writable: true,
                options: [],
              },
              {
                id: 'status',
                name: 'Status',
                dataType: 'SELECT_STRING',
                isMultiSelect: false,
                writable: true,
                options: [{ id: 'option-done', label: 'Done', color: null }],
              },
              {
                id: 'owner',
                name: 'Owner',
                dataType: 'ENTITY',
                specificEntityType: 'USER',
                isMultiSelect: false,
                writable: true,
                options: [],
              },
            ]}
            onChange={change}
          />
        </Dropdown.Content>
      </Dropdown>
    ));
    const trigger = screen.getByRole('button', { name: 'Board menu' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: 'Card title' });
    item.focus();
    fireEvent.keyDown(item, { key: 'ArrowRight' });

    expect(
      (await screen.findAllByRole('menuitemradio')).map(
        (radio) => radio.textContent
      )
    ).toEqual(['Name', 'Status', 'Owner']);
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Name' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Owner' }), {
      key: 'Enter',
    });
    expect(change).toHaveBeenCalledExactlyOnceWith({
      kind: 'board',
      groupBy: 'status',
      title: 'owner',
      lanes: [{ key: { kind: 'option', id: 'option-done' }, hidden: true }],
      cardFields: ['owner'],
      hideEmptyLanes: true,
    });
  });
});
