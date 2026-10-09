import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardMenu } from './board-menu';

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

const columns = [
  {
    id: 'name',
    name: 'Name',
    dataType: 'STRING' as const,
    isMultiSelect: false,
    writable: true,
    options: [],
  },
  {
    id: 'status',
    name: 'Status',
    dataType: 'SELECT_STRING' as const,
    isMultiSelect: false,
    writable: true,
    options: [
      { id: 'option-to-do', label: 'To do', color: null },
      { id: 'option-done', label: 'Done', color: null },
    ],
  },
  {
    id: 'priority',
    name: 'Priority',
    dataType: 'SELECT_STRING' as const,
    isMultiSelect: false,
    writable: true,
    options: [{ id: 'option-high', label: 'High', color: null }],
  },
];

async function openSubmenu(label: string) {
  const trigger = screen.getByRole('button', { name: 'Board menu' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('menuitem', { name: label });
  item.focus();
  fireEvent.keyDown(item, { key: 'ArrowRight' });
}

describe('board menu', () => {
  it('groups the board by another single select, starting its lanes afresh', async () => {
    const change = vi.fn();
    render(() => (
      <BoardMenu
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'status',
          lanes: [{ key: { kind: 'option', id: 'option-done' }, hidden: true }],
          cardFields: ['priority'],
          hideEmptyLanes: false,
        }}
        columns={columns}
        onChange={change}
      />
    ));
    await openSubmenu('Group by');
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Status' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(
      await screen.findByRole('menuitemradio', { name: 'Priority' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({
      kind: 'board',
      title: 'name',
      groupBy: 'priority',
      lanes: [],
      cardFields: ['priority'],
      hideEmptyLanes: false,
    });
  });

  it('titles the cards by another column', async () => {
    const change = vi.fn();
    render(() => (
      <BoardMenu
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'status',
          lanes: [],
          cardFields: ['priority'],
          hideEmptyLanes: false,
        }}
        columns={columns}
        onChange={change}
      />
    ));
    await openSubmenu('Card title');
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Name' })
        .getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.keyDown(
      await screen.findByRole('menuitemradio', { name: 'Priority' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenCalledExactlyOnceWith({
      kind: 'board',
      title: 'priority',
      groupBy: 'status',
      lanes: [],
      cardFields: ['priority'],
      hideEmptyLanes: false,
    });
  });

  it('shows and hides card fields, never offering the group column', async () => {
    const change = vi.fn();
    render(() => (
      <BoardMenu
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'status',
          lanes: [],
          cardFields: ['priority'],
          hideEmptyLanes: false,
        }}
        columns={columns}
        onChange={change}
      />
    ));
    await openSubmenu('Card fields');
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Status' })
    ).toBeNull();
    fireEvent.keyDown(
      await screen.findByRole('menuitemcheckbox', { name: 'Name' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenLastCalledWith({
      kind: 'board',
      title: 'name',
      groupBy: 'status',
      lanes: [],
      cardFields: ['priority', 'name'],
      hideEmptyLanes: false,
    });
    fireEvent.keyDown(
      screen.getByRole('menuitemcheckbox', { name: 'Priority' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenLastCalledWith({
      kind: 'board',
      title: 'name',
      groupBy: 'status',
      lanes: [],
      cardFields: [],
      hideEmptyLanes: false,
    });
  });

  it('hides empty lanes and shows a hidden lane again', async () => {
    const change = vi.fn();
    render(() => (
      <BoardMenu
        layout={{
          kind: 'board',
          title: 'name',
          groupBy: 'status',
          lanes: [
            { key: { kind: 'option', id: 'option-done' }, hidden: true },
            { key: { kind: 'none' }, hidden: true },
          ],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        columns={columns}
        onChange={change}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Board menu' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(
      await screen.findByRole('menuitemcheckbox', { name: 'Hide empty lanes' }),
      { key: 'Enter' }
    );
    expect(change).toHaveBeenLastCalledWith({
      kind: 'board',
      title: 'name',
      groupBy: 'status',
      lanes: [
        { key: { kind: 'option', id: 'option-done' }, hidden: true },
        { key: { kind: 'none' }, hidden: true },
      ],
      cardFields: [],
      hideEmptyLanes: true,
    });
    const hidden = screen.getByRole('menuitem', { name: 'Hidden lanes' });
    hidden.focus();
    fireEvent.keyDown(hidden, { key: 'ArrowRight' });
    expect(
      await screen.findByRole('menuitem', { name: 'Show No status' })
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Show Done' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith({
        kind: 'board',
        title: 'name',
        groupBy: 'status',
        lanes: [
          { key: { kind: 'option', id: 'option-done' }, hidden: false },
          { key: { kind: 'none' }, hidden: true },
        ],
        cardFields: [],
        hideEmptyLanes: false,
      })
    );
  });
});
