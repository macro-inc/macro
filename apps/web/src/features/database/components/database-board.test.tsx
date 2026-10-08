import type { DatabaseOpsError } from '@service-storage/databases';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { err, ok, okAsync, type Result } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneKey } from '../../../lib/core/database-sql/generated/types';
import { OptionEditingContext } from '../context/option-editing';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseBoard } from './database-board';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('database board', () => {
  it('draws a lane per person and moves a card to another person', async () => {
    const owner: DatabaseViewColumn = {
      id: 'owner',
      name: 'Owner',
      dataType: 'ENTITY',
      specificEntityType: 'USER',
      isMultiSelect: false,
      options: [],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: { title: 'Launch project', owner: 'macro|sam@macro.com' },
          },
          { rowId: 'loose', cells: { title: 'Loose end', owner: null } },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          owner,
        ]}
        board={{
          lanes: [
            { key: { kind: 'none' }, hidden: false, cards: ['loose'] },
            {
              key: { kind: 'user', id: 'macro|ana@macro.com' },
              hidden: false,
              cards: [],
            },
            {
              key: { kind: 'user', id: 'macro|sam@macro.com' },
              hidden: false,
              cards: ['launch'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'owner',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={owner}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));

    expect(
      screen
        .getAllByRole('region')
        .map((lane) => lane.getAttribute('aria-label'))
    ).toEqual(['ana@macro.com lane', 'sam@macro.com lane']);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Move Launch project' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'ana@macro.com' }),
      { key: 'Enter' }
    );
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        'launch',
        { kind: 'user', id: 'macro|ana@macro.com' },
        undefined
      )
    );
  });

  it('draws the lanes the board lays out, in its order, and leaves hidden lanes out', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
        { id: 'archived', label: 'Archived', color: null },
      ],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: { title: 'Launch project', status: 'To do' },
          },
          {
            rowId: 'unassigned',
            cells: { title: 'Unassigned record', status: null },
          },
          { rowId: 'old', cells: { title: 'Old record', status: 'Archived' } },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch'],
            },
            {
              key: { kind: 'option', id: 'archived' },
              hidden: true,
              cards: ['old'],
            },
            { key: { kind: 'none' }, hidden: false, cards: ['unassigned'] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    expect(
      screen
        .getAllByRole('region')
        .map((lane) => lane.getAttribute('aria-label'))
    ).toEqual(['Done lane', 'To do lane']);
    expect(
      screen.queryByRole('button', { name: 'Open Unassigned record' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Open Old record' })
    ).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Done lane' })).getByText(
        'Drop a record here'
      )
    ).toBeTruthy();
  });

  it("shows the layout's card fields in order, skipping the title and empty fields", () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: {
              title: 'Launch project',
              status: 'To do',
              owner: 'Ada',
              team: 'Design',
              notes: 'Bring draft',
              due: null,
            },
          },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
          {
            id: 'owner',
            name: 'Owner',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'team',
            name: 'Team',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'notes',
            name: 'Notes',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          {
            id: 'due',
            name: 'Due',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: ['notes', 'title', 'due', 'owner'],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const card = screen.getByRole('button', { name: 'Open Launch project' });
    expect(within(card).getByText('Launch project')).toBeTruthy();
    expect(within(card).queryByText('Design')).toBeNull();
    expect(
      Array.from(
        card.closest('article')!.querySelectorAll('[data-card-field]'),
        (element) => element.getAttribute('title')
      )
    ).toEqual(['Notes: Bring draft', 'Owner: Ada']);
  });

  it('heads each card with its title column, an entity as its chip, never repeated among the fields', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: {
              title: 'Launch project',
              status: 'To do',
              owner: 'macro|ada@example.com',
            },
          },
          {
            rowId: 'unowned',
            cells: { title: 'Tidy backlog', status: 'To do', owner: null },
          },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
          {
            id: 'owner',
            name: 'Owner',
            dataType: 'ENTITY',
            specificEntityType: 'USER',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch', 'unowned'],
            },
          ],
        }}
        layout={{
          kind: 'board',
          groupBy: 'status',
          title: 'owner',
          lanes: [],
          cardFields: ['owner', 'title'],
          hideEmptyLanes: false,
        }}
        renderMentionValue={(id, type) => (
          <span data-testid="mention">{`${type} ${id}`}</span>
        )}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const owned = screen.getByRole('button', { name: 'Open Linked record' });
    expect(within(owned).getByRole('heading', { level: 3 }).textContent).toBe(
      'USER macro|ada@example.com'
    );
    expect(within(owned).getByTestId('mention')).toBeTruthy();
    expect(
      Array.from(
        owned.closest('article')!.querySelectorAll('[data-card-field]'),
        (element) => element.getAttribute('title')
      )
    ).toEqual(['Name: Launch project']);
    const unowned = screen.getByRole('button', { name: 'Open Unnamed' });
    expect(within(unowned).getByRole('heading', { level: 3 }).textContent).toBe(
      'Unnamed'
    );
    expect(
      Array.from(
        unowned.closest('article')!.querySelectorAll('[data-card-field]'),
        (element) => element.getAttribute('title')
      )
    ).toEqual(['Name: Tidy backlog']);
  });

  it('creates and opens a record when the card title is not text it can type into', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
          {
            id: 'due',
            name: 'Due',
            dataType: 'DATE',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          groupBy: 'status',
          title: 'due',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'To do lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    expect(within(lane).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(lane).getByRole('button', { name: 'Add record' }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(
      { kind: 'option', id: 'todo' },
      '',
      expect.any(String),
      { open: true }
    );
  });

  it("moves a card from its Move menu into the chosen lane's option", async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: { title: 'Launch project', status: 'To do' },
          },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'none' }, hidden: false, cards: [] },
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch'],
            },
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Move Launch project' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Done' }), {
      key: 'Enter',
    });
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        'launch',
        { kind: 'option', id: 'done' },
        undefined
      )
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Launch project moved to Done.'
      )
    );
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('menuitem', { name: 'No status' })).toBeNull();
  });

  it('hides a lane from its lane menu, the lane without an option as null', async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onHideLane = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'none' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onHideLane={onHideLane}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const todoMenu = screen.getByRole('button', { name: 'To do lane menu' });
    todoMenu.focus();
    fireEvent.keyDown(todoMenu, { key: 'Enter' });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Hide lane' }),
      { key: 'Enter' }
    );
    await waitFor(() =>
      expect(onHideLane).toHaveBeenCalledWith({ kind: 'option', id: 'todo' })
    );
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Hide empty lanes' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'No status lane menu' })
    ).toBeNull();
  });

  it('turns hiding empty lanes on from a lane menu, checked as the layout has it', async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onHideEmptyLanes = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onHideEmptyLanes={onHideEmptyLanes}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const menu = screen.getByRole('button', { name: 'To do lane menu' });
    menu.focus();
    fireEvent.keyDown(menu, { key: 'Enter' });
    const toggle = await screen.findByRole('menuitemcheckbox', {
      name: 'Hide empty lanes',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: 'Hide lane' })).toBeNull();
    fireEvent.keyDown(toggle, { key: 'Enter' });
    await waitFor(() => expect(onHideEmptyLanes).toHaveBeenCalledWith(true));
  });

  it('has no lane menu when the view cannot change', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    expect(
      screen.queryByRole('button', { name: 'To do lane menu' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add record to To do' })
    ).toBeTruthy();
  });

  it("offers an option's editor on its lane header only to editors with option editing", () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const [canEdit, setCanEdit] = createSignal(true);
    render(() => (
      <OptionEditingContext.Provider
        value={{
          update: vi.fn(() => okAsync(undefined)),
          remove: vi.fn(() => okAsync(undefined)),
        }}
      >
        <DatabaseBoard
          rows={[]}
          columns={[
            {
              id: 'title',
              name: 'Name',
              dataType: 'STRING',
              isMultiSelect: false,
              options: [],
              writable: true,
            },
            status,
          ]}
          board={{
            lanes: [
              { key: { kind: 'none' }, hidden: false, cards: [] },
              { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            ],
          }}
          layout={{
            kind: 'board',
            title: 'title',
            groupBy: 'status',
            lanes: [],
            cardFields: [],
            hideEmptyLanes: false,
          }}
          groupColumn={status}
          canEdit={canEdit()}
          rowPending={() => false}
          onOpen={vi.fn()}
          onMove={vi.fn()}
          onCreate={vi.fn(async () => true)}
        />
      </OptionEditingContext.Provider>
    ));
    expect(
      within(screen.getByRole('region', { name: 'To do lane' })).getByRole(
        'button',
        { name: 'Edit To do' }
      )
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'No status lane' })).toBeNull();
    setCanEdit(false);
    expect(screen.queryByRole('button', { name: 'Edit To do' })).toBeNull();
  });

  it('has no option editor without option editing', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    expect(screen.queryByRole('button', { name: 'Edit To do' })).toBeNull();
  });

  it('reorders lanes with Alt+Arrow, naming every lane in the new order', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    const onLaneOrderChange = vi.fn();
    const onMove = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={onMove}
        onLaneOrderChange={onLaneOrderChange}
        onCreate={vi.fn(async () => true)}
      />
    ));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Reorder Done lane' }),
      {
        key: 'ArrowRight',
        altKey: true,
      }
    );
    expect(onLaneOrderChange).toHaveBeenCalledWith([
      { kind: 'option', id: 'todo' },
      { kind: 'option', id: 'done' },
      { kind: 'none' },
    ]);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keeps a failed new-group draft and lets the user retry it', async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onAddGroup = vi.fn(
      async (_label: string): Promise<Result<void, DatabaseOpsError>> =>
        ok(undefined)
    );
    onAddGroup.mockResolvedValueOnce(
      err({
        code: 'NETWORK_ERROR',
        message: 'Connection unavailable',
        refusal: null,
      })
    );
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    const input = screen.getByRole('textbox', {
      name: 'New group name',
    }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'In review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Your change could not be sent. Check your connection.'
      )
    );
    expect(input.value).toBe('In review');
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() => expect(onAddGroup).toHaveBeenCalledTimes(2));
    expect(onAddGroup).toHaveBeenLastCalledWith('In review');
  });

  it('refuses a new group named like an existing option', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onAddGroup = vi.fn(
      async (_label: string): Promise<Result<void, DatabaseOpsError>> =>
        ok(undefined)
    );
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: 'to DO' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'A group with this name already exists.'
    );
    expect(onAddGroup).not.toHaveBeenCalled();
  });

  it('refuses a new group matching an existing option label once both are trimmed', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done ', color: null }],
      writable: true,
    };
    const onAddGroup = vi.fn(
      async (_label: string): Promise<Result<void, DatabaseOpsError>> =>
        ok(undefined)
    );
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: '  DONE  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'A group with this name already exists.'
    );
    expect(onAddGroup).not.toHaveBeenCalled();
  });

  it('validates numeric groups and sends their canonical labels', async () => {
    const amount: DatabaseViewColumn = {
      id: 'amount',
      name: 'Amount',
      dataType: 'SELECT_NUMBER',
      isMultiSelect: false,
      options: [{ id: 'two', label: '2', color: null }],
      writable: true,
    };
    const onAddGroup = vi.fn(
      async (_label: string): Promise<Result<void, DatabaseOpsError>> =>
        ok(undefined)
    );
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          amount,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'two' }, hidden: false, cards: [] },
            { key: { kind: 'none' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'amount',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={amount}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        onAddGroup={onAddGroup}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: 'not a number' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByRole('alert').textContent).toContain('valid number');
    expect(onAddGroup).not.toHaveBeenCalled();
    fireEvent.input(screen.getByRole('textbox', { name: 'New group name' }), {
      target: { value: '1.0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() => expect(onAddGroup).toHaveBeenCalledWith('1'));
  });

  it("Enter saves a card into its lane's option and opens an empty card below it", () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'Done lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    const first = within(lane).getByRole('textbox', {
      name: 'New record title',
    }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(first);
    fireEvent.input(first, { target: { value: 'First idea' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith(
      { kind: 'option', id: 'done' },
      'First idea',
      expect.any(String)
    );
    const next = within(lane).getByRole('textbox', {
      name: 'New record title',
    }) as HTMLTextAreaElement;
    expect(next).not.toBe(first);
    expect(next.value).toBe('');
    expect(document.activeElement).toBe(next);
    fireEvent.input(next, { target: { value: 'Second idea' } });
    fireEvent.keyDown(next, { key: 'Enter' });
    expect(onCreate).toHaveBeenLastCalledWith(
      { kind: 'option', id: 'done' },
      'Second idea',
      expect.any(String)
    );
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByRole('region', { name: 'To do lane' })).queryByRole(
        'textbox'
      )
    ).toBeNull();
  });

  it('creates a card in the lane without an option with no option', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'todo', label: 'To do', color: null }],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'none' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    expect(
      screen.queryByRole('button', { name: 'Add record to No status' })
    ).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Shift+Enter saves a card and asks to open its record', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'Done lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    const input = within(lane).getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Needs detail' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onCreate).toHaveBeenCalledWith(
      { kind: 'option', id: 'done' },
      'Needs detail',
      expect.any(String),
      { open: true }
    );
    expect(within(lane).queryByRole('textbox')).toBeNull();
  });

  it('Escape cancels a new card and returns focus to its lane', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'Done lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    const input = within(lane).getByRole('textbox', {
      name: 'New record title',
    });
    fireEvent.input(input, { target: { value: 'Not this one' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(lane).queryByRole('textbox')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      within(lane).getByRole('button', { name: 'New record' })
    );
  });

  it('blurring a typed card saves it and blurring an empty card cancels it', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const onCreate = vi.fn(async () => true);
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'Done lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    fireEvent.blur(within(lane).getByRole('textbox'));
    expect(within(lane).queryByRole('textbox')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    const input = within(lane).getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Typed then left' } });
    fireEvent.blur(input);
    expect(onCreate).toHaveBeenCalledWith(
      { kind: 'option', id: 'done' },
      'Typed then left',
      expect.any(String)
    );
    expect(within(lane).queryByRole('textbox')).toBeNull();
  });

  it('n on a focused card or Enter on a lane header adds a card to that lane', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: { title: 'Launch project', status: 'To do' },
          },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch'],
            },
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
      />
    ));
    const todo = screen.getByRole('region', { name: 'To do lane' });
    const card = within(todo).getByRole('button', {
      name: 'Open Launch project',
    });
    card.focus();
    fireEvent.keyDown(card, { key: 'n' });
    expect(document.activeElement).toBe(
      within(todo).getByRole('textbox', { name: 'New record title' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    const done = screen.getByRole('region', { name: 'Done lane' });
    const header = within(done).getByRole('button', { name: 'Done lane' });
    header.focus();
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(document.activeElement).toBe(
      within(done).getByRole('textbox', { name: 'New record title' })
    );
  });

  it('keeps a new-card title after a failed write and unrelated row updates', async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const [rows, setRows] = createSignal<DatabaseRow[]>([]);
    const [cards, setCards] = createSignal<string[]>([]);
    const onCreate = vi.fn(async () => false);
    render(() => (
      <DatabaseBoard
        rows={rows()}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'done' },
              hidden: false,
              cards: cards(),
            },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Done' }));
    const input = screen.getByRole('textbox', {
      name: 'New record title',
    }) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'Remember this draft' } });
    setRows([
      { rowId: 'other', cells: { title: 'Other record', status: 'Done' } },
    ]);
    setCards(['other']);
    expect(
      screen.getByRole('button', { name: 'Open Other record' })
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('textbox', {
          name: 'New record title',
        }) as HTMLTextAreaElement
      ).value
    ).toBe('Remember this draft');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        { kind: 'option', id: 'done' },
        'Remember this draft',
        expect.any(String)
      )
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('textbox', { name: 'New record title' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toEqual(['Remember this draft', ''])
    );
  });

  it('shows a submitted card in place while it saves and keeps its title when the save fails', async () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'done', label: 'Done', color: null }],
      writable: true,
    };
    const [pending, setPending] = createSignal(new Set<string>());
    let complete: (saved: boolean) => void = () => {};
    const onCreate = vi.fn(
      (_lane: LaneKey, _title: string, intentId: string) => {
        setPending((ids) => new Set(ids).add(intentId));
        return new Promise<boolean>((resolve) => {
          complete = (saved) => {
            setPending(
              (ids) => new Set([...ids].filter((id) => id !== intentId))
            );
            resolve(saved);
          };
        });
      }
    );
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        createPending={(id) => pending().has(id)}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={onCreate}
      />
    ));
    const lane = screen.getByRole('region', { name: 'Done lane' });
    fireEvent.click(within(lane).getByRole('button', { name: 'New record' }));
    const input = screen.getByRole('textbox', { name: 'New record title' });
    fireEvent.input(input, { target: { value: 'First idea' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const saving = within(lane).getByRole('status', {
      name: 'Saving new record',
    });
    expect(saving.textContent).toContain('First idea');
    const next = within(lane).getByRole('textbox', {
      name: 'New record title',
    });
    expect(
      saving.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(within(lane).getByText('1')).toBeTruthy();
    complete(false);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('textbox', { name: 'New record title' })
          .map((field) => (field as HTMLTextAreaElement).value)
      ).toEqual(['First idea', ''])
    );
  });

  it('starts a card in the first lane from the host controls', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    let addCard: () => boolean = () => false;
    render(() => (
      <DatabaseBoard
        rows={[]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
            { key: { kind: 'option', id: 'todo' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit
        rowPending={() => false}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        controlsRef={(controls) => {
          addCard = controls.addCard;
        }}
      />
    ));
    expect(addCard()).toBe(true);
    expect(
      within(screen.getByRole('region', { name: 'Done lane' })).getByRole(
        'textbox',
        { name: 'New record title' }
      )
    ).toBeTruthy();
  });

  it('opens records for viewers without exposing move, create or lane controls', () => {
    const status: DatabaseViewColumn = {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [
        { id: 'todo', label: 'To do', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
      writable: true,
    };
    const onOpen = vi.fn();
    render(() => (
      <DatabaseBoard
        rows={[
          {
            rowId: 'launch',
            cells: { title: 'Launch project', status: 'To do' },
          },
        ]}
        columns={[
          {
            id: 'title',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            options: [],
            writable: true,
          },
          status,
        ]}
        board={{
          lanes: [
            {
              key: { kind: 'option', id: 'todo' },
              hidden: false,
              cards: ['launch'],
            },
            { key: { kind: 'option', id: 'done' }, hidden: false, cards: [] },
          ],
        }}
        layout={{
          kind: 'board',
          title: 'title',
          groupBy: 'status',
          lanes: [],
          cardFields: [],
          hideEmptyLanes: false,
        }}
        groupColumn={status}
        canEdit={false}
        rowPending={() => false}
        onOpen={onOpen}
        onMove={vi.fn()}
        onCreate={vi.fn(async () => true)}
        onAddGroup={vi.fn(async () => ok(undefined))}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Launch project' })
    );
    expect(onOpen).toHaveBeenCalledWith('launch');
    expect(
      screen.queryByRole('button', { name: 'Move Launch project' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Add record to Done' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Done lane' })).getByText(
        'No records'
      )
    ).toBeTruthy();
  });
});
