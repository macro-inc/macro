import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterPanel, filterConditionCount } from './database-view-filters';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('database filter panel', () => {
  it('saves a condition once its value is typed', () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={null}
        onChange={change}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(change).not.toHaveBeenCalled();
    const value = screen.getByRole('textbox', { name: 'Filter value' });
    value.focus();
    fireEvent.input(value, { target: { value: 'Plan' } });
    expect(change).toHaveBeenCalledExactlyOnceWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Plan' },
        },
      ],
    });
    fireEvent.input(value, { target: { value: 'Planning' } });
    expect(screen.getByRole('textbox', { name: 'Filter value' })).toBe(value);
    expect(document.activeElement).toBe(value);
    expect(change).toHaveBeenLastCalledWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Planning' },
        },
      ],
    });
  });

  it('leaves an unfinished condition out of what it saves', () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={{
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
          ],
        }}
        onChange={change}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(
      screen.getAllByRole('textbox', { name: 'Filter value' })
    ).toHaveLength(2);
    expect(change).not.toHaveBeenCalled();
    fireEvent.input(
      screen.getAllByRole('textbox', { name: 'Filter value' })[1],
      { target: { value: '   ' } }
    );
    expect(change).not.toHaveBeenCalled();
  });

  it('switches the root group to Or', async () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
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
            id: 'amount',
            name: 'Amount',
            dataType: 'NUMBER',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={{
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
            {
              kind: 'condition',
              column: 'amount',
              test: { kind: 'number', operator: 'greaterThan', value: 5 },
            },
          ],
        }}
        onChange={change}
      />
    ));
    expect(screen.getByText('Where')).toBeTruthy();
    const conjunction = screen.getByRole('button', {
      name: /^Match conditions with/,
    });
    expect(conjunction.textContent).toBe('And');
    fireEvent.keyDown(conjunction, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Or' }), {
      key: 'Enter',
    });
    expect(change).toHaveBeenCalledExactlyOnceWith({
      conjunction: 'or',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Plan' },
        },
        {
          kind: 'condition',
          column: 'amount',
          test: { kind: 'number', operator: 'greaterThan', value: 5 },
        },
      ],
    });
    expect(
      screen.getByRole('button', { name: /^Match conditions with/ }).textContent
    ).toBe('Or');
  });

  it('saves a nested Or group inside an And root', () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={{
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
          ],
        }}
        onChange={change}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    const group = screen.getByRole('group', { name: 'Filter group' });
    fireEvent.click(
      within(group).getByRole('button', { name: 'Add condition' })
    );
    expect(change).not.toHaveBeenCalled();
    expect(
      within(group).getByRole('button', { name: /^Match conditions with/ })
        .textContent
    ).toBe('Or');
    const [first, second] = within(group).getAllByRole('textbox', {
      name: 'Filter value',
    });
    fireEvent.input(first, { target: { value: 'Launch' } });
    fireEvent.input(second, { target: { value: 'Review' } });
    expect(change).toHaveBeenLastCalledWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Plan' },
        },
        {
          kind: 'group',
          conjunction: 'or',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Launch' },
            },
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Review' },
            },
          ],
        },
      ],
    });
  });

  it('saves the ids of the options an options test picks', async () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
        columns={[
          {
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            writable: true,
            options: [
              { id: 'option-to-do', label: 'To do', color: null },
              { id: 'option-done', label: 'Done', color: '#16a34a' },
            ],
          },
        ]}
        filter={null}
        onChange={change}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    const value = screen.getByRole('button', { name: /^Filter value/ });
    expect(value.textContent).toBe('Choose');
    await userEvent.click(value);
    await userEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Done' })
    );
    expect(change).toHaveBeenLastCalledWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'status',
          test: {
            kind: 'options',
            operator: 'isAnyOf',
            options: ['option-done'],
          },
        },
      ],
    });
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'To do' })
    );
    expect(change).toHaveBeenLastCalledWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'status',
          test: {
            kind: 'options',
            operator: 'isAnyOf',
            options: ['option-done', 'option-to-do'],
          },
        },
      ],
    });
  });

  it('removes a group along with its last condition', () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
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
            id: 'amount',
            name: 'Amount',
            dataType: 'NUMBER',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={{
          conjunction: 'and',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
            {
              kind: 'group',
              conjunction: 'or',
              conditions: [
                {
                  kind: 'condition',
                  column: 'amount',
                  test: { kind: 'number', operator: 'greaterThan', value: 5 },
                },
              ],
            },
          ],
        }}
        onChange={change}
      />
    ));
    const group = screen.getByRole('group', { name: 'Filter group' });
    fireEvent.click(
      within(group).getByRole('button', { name: 'Remove filter' })
    );
    expect(screen.queryByRole('group', { name: 'Filter group' })).toBeNull();
    expect(change).toHaveBeenCalledExactlyOnceWith({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Plan' },
        },
      ],
    });
  });

  it('saves no filter once the filters are cleared', () => {
    const change = vi.fn();
    render(() => (
      <FilterPanel
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        filter={{
          conjunction: 'or',
          conditions: [
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'text', operator: 'contains', value: 'Plan' },
            },
            {
              kind: 'condition',
              column: 'name',
              test: { kind: 'presence', operator: 'isEmpty' },
            },
          ],
        }}
        onChange={change}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(change).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.queryAllByRole('button', { name: 'Remove filter' })).toEqual(
      []
    );
    expect(screen.getByRole('button', { name: 'Add condition' })).toBeTruthy();
  });
});

describe('filter condition count', () => {
  it('counts nested conditions', () => {
    expect(
      filterConditionCount({
        conjunction: 'and',
        conditions: [
          {
            kind: 'condition',
            column: 'name',
            test: { kind: 'text', operator: 'contains', value: 'Plan' },
          },
          {
            kind: 'group',
            conjunction: 'or',
            conditions: [
              {
                kind: 'condition',
                column: 'amount',
                test: { kind: 'number', operator: 'greaterThan', value: 5 },
              },
              {
                kind: 'condition',
                column: 'amount',
                test: { kind: 'presence', operator: 'isEmpty' },
              },
            ],
          },
        ],
      })
    ).toBe(3);
    expect(filterConditionCount(null)).toBe(0);
  });
});
