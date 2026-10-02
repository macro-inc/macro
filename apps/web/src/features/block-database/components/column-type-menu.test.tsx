import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DatabaseColumnCasts,
  DatabaseColumnConversion,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { DatabaseColumnHeader } from './database-column-header';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

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
    {
      target: {
        dataType: 'ENTITY',
        isMultiSelect: false,
        specificEntityType: 'USER',
        relation: false,
      },
      cast: {
        verdict: 'never',
        reason: 'Only an empty column can become a reference column.',
      },
    },
  ],
};

let menuStyles: HTMLStyleElement;
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
  menuStyles = document.createElement('style');
  menuStyles.textContent = '[role=menu] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
});

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
  const opened: string[] = [];
  render(() => (
    <DatabaseColumnHeader
      column={column}
      canRename
      onRename={vi.fn(() => okAsync(undefined))}
      onSort={vi.fn()}
      onChangeType={changeType}
      onConvert={convert}
      columnCasts={(columnId, open) => () => {
        if (open()) opened.push(columnId);
        return casts;
      }}
    />
  ));
  return { changeType, convert, opened };
}

async function openTypeMenu() {
  fireEvent.keyDown(screen.getByRole('columnheader', { name: 'Price' }), {
    key: 'Enter',
  });
  const submenu = await screen.findByRole('menuitem', { name: 'Change type' });
  submenu.focus();
  fireEvent.keyDown(submenu, { key: 'ArrowRight' });
}

function choose(item: HTMLElement) {
  fireEvent(item, new MouseEvent('pointerup', { button: 0, bubbles: true }));
}

it('lists only the types the column can become', async () => {
  const { opened } = renderHeader();
  await openTypeMenu();

  expect(await screen.findByRole('menuitem', { name: /^Number/ })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /^People/ })).toBeNull();
  expect(opened).toContain('price');
});

it('offers a checked type with failures as a new column, never as a type change', async () => {
  const { changeType, convert } = renderHeader();
  await openTypeMenu();

  const number = await screen.findByRole('menuitem', { name: 'Number' });
  expect(number.textContent).toContain("3 values aren't numbers");
  expect(number.textContent).toContain('Converts into a new column');
  choose(number);

  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain("3 values don't fit Number");
  expect(dialog.textContent).toContain(
    'A new Number column will be added next to this one with the values that convert'
  );
  expect(dialog.textContent).toContain('TBD');
  expect(dialog.textContent).toContain('n/a');
  expect(dialog.textContent).toContain('12.5.0');
  fireEvent.click(
    screen.getByRole('button', { name: 'Convert into a new column' })
  );
  await waitFor(() =>
    expect(convert).toHaveBeenCalledExactlyOnceWith('price', {
      to: { type: 'number' },
      label: 'Number',
      columnName: 'Price',
    })
  );
  expect(changeType).not.toHaveBeenCalled();
});

it('applies a type every value fits directly, against the version its dry run read', async () => {
  const { changeType } = renderHeader();
  await openTypeMenu();

  choose(await screen.findByRole('menuitem', { name: 'Select' }));

  await waitFor(() =>
    expect(changeType).toHaveBeenCalledExactlyOnceWith('price', {
      to: { type: 'select', multi: false },
      baseVersion: 4,
    })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
