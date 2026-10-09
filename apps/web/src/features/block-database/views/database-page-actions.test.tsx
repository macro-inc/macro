import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '../../../lib/core/component/Toast/Toast';
import { DatabaseTitle } from '../../database/components/database-title';
import type { DatabaseEntityFailure } from '../../database/core/write-failure';
import { DatabasePageActions } from './database-page-actions';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  csv: vi.fn(),
}));
vi.mock('../../../lib/core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.download }));
vi.mock('../queries/transfer', () => ({
  exportDatabaseTableCsv: mocks.csv,
  importDatabaseTable: vi.fn(),
}));

let presenceStyles: HTMLStyleElement;
beforeEach(() => {
  presenceStyles = document.createElement('style');
  presenceStyles.textContent =
    '[role=menu], [role=dialog] { animation-name: none; }';
  document.head.append(presenceStyles);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  mocks.download.mockReset();
  mocks.csv.mockReset().mockReturnValue(okAsync(new Blob(['Name\nAcme'])));
});
afterEach(() => {
  cleanup();
  presenceStyles.remove();
  vi.restoreAllMocks();
});

function setup(
  grant: DatabaseDetail['grant'] = 'owner',
  remove = vi.fn(
    (): ResultAsync<void, DatabaseEntityFailure> => okAsync(undefined)
  )
) {
  let editTitle: (() => void) | undefined;
  render(() => (
    <>
      <DatabaseTitle
        name="Customers"
        canEdit={grant !== 'view'}
        onRename={vi.fn()}
        onEditReady={(edit) => (editTitle = edit)}
      />
      <DatabasePageActions
        detail={
          {
            database: { id: 'db', name: 'Customers', owner_id: 'owner' },
            grant,
            tables: [],
          } as unknown as DatabaseDetail
        }
        table={{ table: { id: 'table', name: 'Contacts' } } as TableDetail}
        onImported={vi.fn()}
        onRename={() => editTitle?.()}
        onDelete={remove}
      />
    </>
  ));
  return { remove };
}
async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Database actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.findByRole('menu');
}
function selectItem(name: string) {
  const item = screen.getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

describe('database page actions', () => {
  it('focuses the inline title from Rename', async () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Download database' })
    ).toBeNull();
    await openMenu();
    selectItem('Rename');
    const title = await screen.findByRole('textbox', { name: 'Database name' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it.each(['edit', 'view'] as const)(
    'gates mutations for %s access',
    async (grant) => {
      setup(grant);
      await openMenu();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
      expect(Boolean(screen.queryByRole('menuitem', { name: 'Rename' }))).toBe(
        grant === 'edit'
      );
      expect(
        Boolean(screen.queryByRole('menuitem', { name: 'Import CSV' }))
      ).toBe(grant === 'edit');
      expect(screen.getByRole('menuitem', { name: 'Download' })).toBeTruthy();
    }
  );
  it('downloads the current table as CSV from the nested menu, with no other format', async () => {
    setup();
    await openMenu();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Download' }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('menuitem', { name: 'Current table as CSV' });
    expect(
      screen.queryByRole('menuitem', { name: 'Database as SQLite' })
    ).toBeNull();
    selectItem('Current table as CSV');
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        expect.any(Blob),
        'Contacts.csv'
      )
    );
  });
  it('opens CSV import from the menu and returns focus to the persistent ellipsis', async () => {
    setup();
    await openMenu();
    const input = screen.getByLabelText('Choose CSV file');
    const choose = vi.spyOn(input, 'click');
    selectItem('Import CSV');
    expect(choose).toHaveBeenCalledOnce();
    fireEvent.change(input, {
      target: {
        files: [
          { name: 'Contacts.csv', size: 9, text: async () => 'Name\nAcme' },
        ],
      },
    });
    const name = await screen.findByRole('textbox', { name: 'Table name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Database actions' })
      )
    );
  });
  it('says a file could not be read and accepts the next one', async () => {
    setup();
    const input = screen.getByLabelText('Choose CSV file');
    fireEvent.change(input, {
      target: {
        files: [
          {
            name: 'Broken.csv',
            size: 9,
            text: () => Promise.reject(new Error('NotReadableError')),
          },
        ],
      },
    });
    await waitFor(() =>
      expect(toast.failure).toHaveBeenCalledWith('Could not read this file.')
    );
    fireEvent.change(input, {
      target: {
        files: [
          { name: 'Contacts.csv', size: 9, text: async () => 'Name\nAcme' },
        ],
      },
    });
    const name = (await screen.findByRole('textbox', {
      name: 'Table name',
    })) as HTMLInputElement;
    expect(name.value).toBe('Contacts');
  });
  it('names an imported table apart from existing names, ignoring case and spaces', async () => {
    render(() => (
      <DatabasePageActions
        detail={
          {
            database: { id: 'db', name: 'Customers', owner_id: 'owner' },
            grant: 'owner',
            tables: [{ table: { id: 'contacts', name: ' contacts ' } }],
          } as unknown as DatabaseDetail
        }
        onImported={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn(() => okAsync(undefined))}
      />
    ));
    fireEvent.change(screen.getByLabelText('Choose CSV file'), {
      target: {
        files: [
          { name: 'Contacts.csv', size: 9, text: async () => 'Name\nAcme' },
        ],
      },
    });
    const name = (await screen.findByRole('textbox', {
      name: 'Table name',
    })) as HTMLInputElement;
    expect(name.value).toBe('Contacts 2');
  });
  it('confirms deletion and retains a failed dialog for retry', async () => {
    const remove = vi
      .fn()
      .mockReturnValueOnce(errAsync({ kind: 'unreachable' }))
      .mockReturnValueOnce(okAsync(undefined));
    setup('owner', remove);
    await openMenu();
    selectItem('Delete');
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete database?',
    });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Could not delete this database. Try again.'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
