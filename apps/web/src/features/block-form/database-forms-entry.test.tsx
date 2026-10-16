import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Dropdown } from '@ui/components/Dropdown';
import { okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatabaseFormEditors,
  DatabaseFormsEntry,
} from './database-forms-entry';

const forms = vi.hoisted(() => ({
  listed: [] as { id: string; name: string; tableId: string; status: string }[],
  createForm: vi.fn(),
}));
vi.mock('@queries/storage/forms', () => ({
  useFormsForDatabaseQuery: () => ({ isSuccess: true, data: forms.listed }),
  createForm: forms.createForm,
}));
const replaceOrInsertSplit = vi.hoisted(() => vi.fn());
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ replaceOrInsertSplit }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
const openWithSplit = vi.hoisted(() => vi.fn());
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  forms.listed = [];
  forms.createForm.mockReset();
  replaceOrInsertSplit.mockReset();
});

describe('DatabaseFormsEntry', () => {
  it('opens the forms menu and navigates to an existing form', async () => {
    forms.listed = [
      { id: 'form-1', name: 'RSVP', tableId: 'table-1', status: 'open' },
    ];
    render(() => (
      <Dropdown open>
        <Dropdown.Trigger>Add</Dropdown.Trigger>
        <Dropdown.Content>
          <DatabaseFormsEntry
            databaseId="database-1"
            tableId="table-1"
            tableName="Guests"
            canCreate
            enabled
          />
        </Dropdown.Content>
      </Dropdown>
    ));
    const form = await screen.findByRole('menuitem', { name: 'RSVP Open' });
    expect(
      screen.getByRole('group', { name: 'Forms writing to Guests' })
    ).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'New form' })).toBeNull();
    form.focus();
    fireEvent.keyDown(form, { key: 'Enter' });
    expect(replaceOrInsertSplit).toHaveBeenCalledWith({
      type: 'form',
      id: 'form-1',
    });
  });

  it('creates a form over the current table from the add menu', async () => {
    forms.createForm.mockReturnValue(okAsync({ form: { id: 'form-new' } }));
    render(() => (
      <Dropdown open>
        <Dropdown.Trigger>Add</Dropdown.Trigger>
        <Dropdown.Content>
          <DatabaseFormsEntry
            databaseId="database-1"
            tableId="table-1"
            tableName="Guests"
            canCreate
            enabled
          />
        </Dropdown.Content>
      </Dropdown>
    ));
    const create = screen.getByRole('menuitem', { name: 'New form' });
    fireEvent.keyDown(create, { key: 'Enter' });
    expect(forms.createForm).toHaveBeenCalledWith(
      {
        name: 'Guests form',
        source: { kind: 'table', databaseId: 'database-1', tableId: 'table-1' },
      },
      'database'
    );
    await vi.waitFor(() =>
      expect(replaceOrInsertSplit).toHaveBeenCalledWith({
        type: 'form',
        id: 'form-new',
      })
    );
  });

  it('offers editors no creation, but keeps the forms that exist', () => {
    const { unmount } = render(() => (
      <Dropdown open>
        <Dropdown.Trigger>Add</Dropdown.Trigger>
        <Dropdown.Content>
          <DatabaseFormsEntry
            databaseId="database-1"
            tableId="table-1"
            tableName="Guests"
            canCreate={false}
            enabled
          />
        </Dropdown.Content>
      </Dropdown>
    ));
    expect(screen.queryByRole('menuitem', { name: 'New form' })).toBeNull();
    unmount();
    forms.listed = [
      { id: 'form-1', name: 'RSVP', tableId: 'table-1', status: 'open' },
    ];
    render(() => (
      <Dropdown open>
        <Dropdown.Trigger>Add</Dropdown.Trigger>
        <Dropdown.Content>
          <DatabaseFormsEntry
            databaseId="database-1"
            tableId="table-1"
            tableName="Guests"
            canCreate={false}
            enabled
          />
        </Dropdown.Content>
      </Dropdown>
    ));
    expect(screen.getByRole('menuitem', { name: 'RSVP Open' })).toBeTruthy();
  });
});

describe('DatabaseFormEditors', () => {
  it('tells the database’s share dialog that each form’s editors can edit it, and opens that form’s sharing', () => {
    forms.listed = [
      { id: 'form-1', name: 'RSVP', tableId: 'table-1', status: 'open' },
    ];
    render(() => <DatabaseFormEditors databaseId="database-1" />);
    expect(
      screen.getByText(/Editors of these forms can also edit this database/)
    ).toBeTruthy();
    screen.getByRole('button', { name: 'RSVP sharing' }).click();
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'form', id: 'form-1', params: { view: 'share' } },
      { preferNewSplit: true, activate: true, referredFrom: null }
    );
  });

  it('says nothing when no form writes to the database', () => {
    forms.listed = [];
    const { container } = render(() => (
      <DatabaseFormEditors databaseId="database-1" />
    ));
    expect(container.textContent).toBe('');
  });
});
