import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseColumnHeader } from '../../components/database-column-header';
import { ColumnMenuContext } from '../../context/column-menu';
import type {
  DatabaseColumnCasts,
  DatabaseColumnConversion,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../../core/column-schema';
import type { DatabaseViewColumn } from '../../core/database-view';
import { ColumnMenuDrawer } from './column-menu-drawer';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

const column: DatabaseViewColumn = {
  id: 'price',
  name: 'Price',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
};

const casts: DatabaseColumnCasts = {
  status: 'ready',
  version: 4,
  casts: [
    {
      target: { dataType: 'STRING', isMultiSelect: false, relation: false },
      cast: { verdict: 'safe' },
    },
    {
      target: { dataType: 'NUMBER', isMultiSelect: false, relation: false },
      cast: {
        verdict: 'checked',
        failures: 3,
        summary: "3 values aren't numbers",
        examples: ['TBD', 'n/a', '12.5.0'],
      },
    },
    {
      target: {
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        relation: false,
      },
      cast: {
        verdict: 'checked',
        failures: 0,
        summary: undefined,
        examples: [],
      },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
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
  vi.unstubAllGlobals();
});

/** The real column header, drawing its menu as the touch page's sheet. */
function renderHeader() {
  const changeType = vi.fn<
    (columnId: string, change: DatabaseColumnTypeChange) => DatabaseSchemaChange
  >(() => okAsync(undefined));
  const convert = vi.fn<
    (
      columnId: string,
      conversion: DatabaseColumnConversion
    ) => DatabaseSchemaChange<string>
  >(() => okAsync('price-number'));
  const sort = vi.fn();
  render(() => (
    <ColumnMenuContext.Provider value={ColumnMenuDrawer}>
      <DatabaseColumnHeader
        column={column}
        canRename
        onRename={vi.fn(() => okAsync(undefined))}
        onSort={sort}
        onChangeType={changeType}
        onConvert={convert}
        columnCasts={() => () => casts}
      />
    </ColumnMenuContext.Provider>
  ));
  return { changeType, convert, sort };
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Price column menu' }));
  return screen.findByRole('dialog', { name: 'Price column' });
}

it('opens the types in the same sheet and comes back to the actions', async () => {
  renderHeader();
  const sheet = await openSheet();
  const changeTypeRow = within(sheet).getByRole('button', {
    name: /^Change type/,
  });
  expect(changeTypeRow.textContent).toContain('Text');

  fireEvent.click(changeTypeRow);

  expect(
    within(sheet)
      .getByRole('button', { name: 'Text' })
      .getAttribute('aria-current')
  ).toBe('true');
  expect(
    within(sheet)
      .getByRole('button', { name: 'Select' })
      .getAttribute('aria-current')
  ).toBeNull();
  expect(
    within(sheet).queryByRole('button', { name: 'Sort ascending' })
  ).toBeNull();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);

  fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }));

  expect(
    within(sheet).getByRole('button', { name: 'Sort ascending' })
  ).toBeTruthy();
  expect(within(sheet).queryByRole('button', { name: 'Select' })).toBeNull();
});

it('changes to a type every value fits and closes the sheet', async () => {
  const { changeType } = renderHeader();
  const sheet = await openSheet();
  fireEvent.click(within(sheet).getByRole('button', { name: /^Change type/ }));

  fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }));

  await waitFor(() =>
    expect(changeType).toHaveBeenCalledExactlyOnceWith('price', {
      to: { type: 'select', multi: false },
      baseVersion: 4,
    })
  );
  expect(
    screen
      .getByRole('button', { name: 'Price column menu' })
      .getAttribute('aria-expanded')
  ).toBe('false');
});

it('offers a type some values do not fit as a new column, with the same warning as the desktop menu', async () => {
  const { changeType, convert } = renderHeader();
  const sheet = await openSheet();
  fireEvent.click(within(sheet).getByRole('button', { name: /^Change type/ }));
  const number = within(sheet).getByRole('button', { name: /^Number/ });
  expect(number.textContent).toContain("3 values aren't numbers");
  expect(number.textContent).toContain('Converts into a new column');

  fireEvent.click(number);

  const confirm = await screen.findByRole('button', {
    name: 'Convert into a new column',
  });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(convert).toHaveBeenCalledExactlyOnceWith('price', {
      to: { type: 'number' },
      label: 'Number',
      columnName: 'Price',
    })
  );
  expect(changeType).not.toHaveBeenCalled();
});

it('runs an action and closes the sheet', async () => {
  const { sort } = renderHeader();
  const sheet = await openSheet();

  fireEvent.click(
    within(sheet).getByRole('button', { name: 'Sort ascending' })
  );

  expect(sort).toHaveBeenCalledExactlyOnceWith('price', 'asc');
  expect(
    screen
      .getByRole('button', { name: 'Price column menu' })
      .getAttribute('aria-expanded')
  ).toBe('false');
});
