import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DatabaseFormEditors,
  DatabaseFormsEntry,
  useTableFormCreation,
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

afterEach(cleanup);
beforeEach(() => {
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
      <DatabaseFormsEntry
        databaseId="database-1"
        tableId="table-1"
        tableName="Guests"
        canCreate
        enabled
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Forms over Guests' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const form = await screen.findByRole('menuitem', { name: 'RSVP Open' });
    expect(
      screen.getByRole('group', { name: 'Forms writing to Guests' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'New form from this table' })
    ).toBeNull();
    form.focus();
    fireEvent.keyDown(form, { key: 'Enter' });
    expect(replaceOrInsertSplit).toHaveBeenCalledWith({
      type: 'form',
      id: 'form-1',
    });
  });

  it('offers + Form to the database owner when no form writes to the table', () => {
    render(() => (
      <DatabaseFormsEntry
        databaseId="database-1"
        tableId="table-1"
        tableName="Guests"
        canCreate
        enabled
      />
    ));
    expect(screen.getByRole('button', { name: /Form/ })).toBeTruthy();
  });

  it('offers editors no creation, but keeps the forms that exist', () => {
    const { unmount } = render(() => (
      <DatabaseFormsEntry
        databaseId="database-1"
        tableId="table-1"
        tableName="Guests"
        canCreate={false}
        enabled
      />
    ));
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    forms.listed = [
      { id: 'form-1', name: 'RSVP', tableId: 'table-1', status: 'open' },
    ];
    render(() => (
      <DatabaseFormsEntry
        databaseId="database-1"
        tableId="table-1"
        tableName="Guests"
        canCreate={false}
        enabled
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Forms over Guests' }).textContent
    ).toContain('1 form');
  });
});

describe('useTableFormCreation', () => {
  it('gives owners a Form choice that creates over the table and opens it', async () => {
    forms.createForm.mockReturnValue(
      okAsync({ form: { id: 'form-new', name: 'RSVP' } })
    );
    await createRoot(async (dispose) => {
      const choice = useTableFormCreation({
        databaseId: () => 'database-1',
        tableId: () => 'table-1',
        tableName: () => 'Guests',
        isOwner: () => true,
        enabled: () => true,
      });
      expect(choice()?.initialName).toBe('Guests form');
      expect(await choice()?.onCreate('RSVP')).toBeUndefined();
      expect(forms.createForm).toHaveBeenCalledWith(
        {
          name: 'RSVP',
          source: {
            kind: 'table',
            databaseId: 'database-1',
            tableId: 'table-1',
          },
        },
        'database'
      );
      expect(replaceOrInsertSplit).toHaveBeenCalledWith({
        type: 'form',
        id: 'form-new',
      });
      dispose();
    });
  });

  it('gives editors no Form choice', () => {
    createRoot((dispose) => {
      const choice = useTableFormCreation({
        databaseId: () => 'database-1',
        tableId: () => 'table-1',
        tableName: () => 'Guests',
        isOwner: () => false,
        enabled: () => true,
      });
      expect(choice()).toBeUndefined();
      dispose();
    });
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
