import type {
  DatabaseDetail,
  DatabaseTableDetail,
} from '@service-storage/databases';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTitle } from '../components/database-title';
import { DatabasePageActions } from './database-page-actions';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  snapshot: vi.fn(),
  csv: vi.fn(),
}));
vi.mock('@core/component/LiveIndicators', () => ({
  LiveIndicators: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
vi.mock('@core/state/liveIndicators', () => ({
  useUserIndicators: () => () => [],
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));
vi.mock('@core/component/TopBar/ShareButton', async () => ({
  ShareDialogContext: (await import('solid-js')).createContext(),
  ShareTrigger: () => <button type="button">Share</button>,
  ShareModal: () => null,
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.download }));
vi.mock('@queries/storage/databases', () => ({
  downloadDatabaseSnapshot: mocks.snapshot,
}));
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
  mocks.snapshot.mockReset().mockResolvedValue(new Blob(['sqlite']));
  mocks.csv.mockReset().mockResolvedValue(new Blob(['Name\nAcme']));
});
afterEach(() => {
  cleanup();
  presenceStyles.remove();
  vi.restoreAllMocks();
});

function setup(
  grant: DatabaseDetail['grant'] = 'owner',
  remove = vi.fn(async () => {})
) {
  let editTitle: (() => void) | undefined;
  render(() => (
    <>
      <DatabaseTitle
        name="Customers"
        canEdit={grant !== 'view'}
        onRename={vi.fn(async () => {})}
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
        table={
          { table: { id: 'table', name: 'Contacts' } } as DatabaseTableDetail
        }
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
  it('keeps Share visible and focuses the inline title from Rename', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
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
  it('downloads the selected format from the nested native menu', async () => {
    setup();
    await openMenu();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Download' }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('menuitem', { name: 'Current table as CSV' });
    selectItem('Current table as CSV');
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        expect.any(Blob),
        'Contacts.csv'
      )
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
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
  it('confirms deletion and retains a failed dialog for retry', async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(undefined);
    setup('owner', remove);
    await openMenu();
    selectItem('Delete');
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete database?',
    });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Connection lost'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
