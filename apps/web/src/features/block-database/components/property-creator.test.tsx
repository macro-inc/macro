import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseRelationTables } from '../core/property-creation';
import { PropertyCreator } from './property-creator';
import { ToolbarPopover } from './view-control-popover';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role=menu], [role=dialog] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.unstubAllGlobals();
});

async function chooseType(label: string) {
  const trigger = screen.getByRole('button', { name: /^Column type:/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const item = await screen.findByRole('menuitemradio', { name: label });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
  );
}

describe('property creation', () => {
  it('only reveals the related table picker for Relation and requires a target before saving', async () => {
    const create = vi.fn(async () => {});
    render(() => (
      <PropertyCreator
        existingNames={[]}
        relationTables={{
          status: 'ready',
          tables: [
            { id: 'customers', name: 'Customers' },
            { id: 'tickets', name: 'Tickets' },
          ],
        }}
        onCreate={create}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const name = await screen.findByLabelText('Column name');
    expect(
      screen.queryByRole('button', { name: /^Related table:/ })
    ).toBeNull();
    fireEvent.input(name, { target: { value: 'Customer' } });
    await chooseType('Relation');
    fireEvent.submit(name.closest('form')!);
    expect(create).not.toHaveBeenCalled();
    const relatedTable = screen.getByRole('button', {
      name: 'Related table: Choose a table',
    });
    relatedTable.focus();
    fireEvent.keyDown(relatedTable, { key: 'ArrowDown' });
    const customers = await screen.findByRole('menuitemradio', {
      name: 'Customers',
    });
    customers.focus();
    fireEvent.keyDown(customers, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(relatedTable));
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledExactlyOnceWith({
        name: 'Customer',
        dataType: 'ENTITY',
        inferType: false,
        options: [],
        relationTableId: 'customers',
      })
    );
  });

  it('requires a currently available table and clears relation metadata when switching to Text', async () => {
    const create = vi.fn(async () => {});
    const [tables, setTables] = createSignal<DatabaseRelationTables>({
      status: 'ready',
      tables: [{ id: 'customers', name: 'Customers' }],
    });
    render(() => (
      <PropertyCreator
        existingNames={[]}
        relationTables={tables()}
        onCreate={create}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    await chooseType('Relation');
    const relatedTable = screen.getByRole('button', {
      name: 'Related table: Choose a table',
    });
    relatedTable.focus();
    fireEvent.keyDown(relatedTable, { key: 'ArrowDown' });
    const customers = await screen.findByRole('menuitemradio', {
      name: 'Customers',
    });
    customers.focus();
    fireEvent.keyDown(customers, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    setTables({ status: 'ready', tables: [] });
    const form = screen.getByLabelText('Column name').closest('form')!;
    fireEvent.submit(form);
    expect(create).not.toHaveBeenCalled();
    await chooseType('Text');
    expect(
      screen.queryByRole('button', { name: /^Related table:/ })
    ).toBeNull();
    fireEvent.submit(form);
    await waitFor(() =>
      expect(create).toHaveBeenCalledExactlyOnceWith({
        name: 'Unnamed',
        dataType: 'STRING',
        inferType: false,
        options: [],
      })
    );
  });

  it('keeps a failed table lookup local to Relation and offers retry', async () => {
    const retry = vi.fn();
    const create = vi.fn(async () => {});
    render(() => (
      <PropertyCreator
        existingNames={[]}
        relationTables={{ status: 'error', retry }}
        onCreate={create}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await chooseType('Relation');
    expect(screen.getByRole('alert').textContent).toContain(
      'Tables could not be loaded'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves nested popup focus ownership and hands a successful create to the grid', async () => {
    let cell!: HTMLInputElement;
    const created = vi.fn(() => {
      cell.focus();
      return true;
    });
    const create = vi.fn(async () => {});
    render(() => (
      <>
        <ToolbarPopover label="View settings" icon={<span />}>
          <PropertyCreator
            existingNames={[]}
            onCreate={create}
            onCreated={created}
          />
        </ToolbarPopover>
        <input ref={cell} aria-label="Created column cell" />
      </>
    ));
    const settings = screen.getByRole('button', { name: 'View settings' });
    fireEvent.click(settings);
    const addColumn = await screen.findByRole('button', { name: 'Add column' });
    await waitFor(() => expect(document.activeElement).toBe(addColumn));
    fireEvent.click(addColumn);
    const name = await screen.findByLabelText('Column name');
    const columnDialog = screen.getByRole('dialog', { name: 'New column' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    await chooseType('Select');
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Column type: Select' }),
      { key: 'Escape' }
    );
    await waitFor(() => expect(columnDialog.isConnected).toBe(false));
    expect(screen.getByRole('dialog', { name: 'View settings' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(addColumn));
    fireEvent.click(addColumn);
    const reopened = await screen.findByLabelText('Column name');
    await waitFor(() => expect(document.activeElement).toBe(reopened));
    fireEvent.submit(reopened.closest('form')!);
    await waitFor(() => expect(document.activeElement).toBe(cell));
    expect(created).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it('keeps the form draft and returns focus through the nested type menu', async () => {
    const create = vi.fn(async () => {});
    render(() => <PropertyCreator existingNames={[]} onCreate={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const name = await screen.findByLabelText('Column name');
    fireEvent.input(name, { target: { value: 'Website' } });
    await chooseType('URL');
    const trigger = screen.getByRole('button', { name: 'Column type: URL' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const selected = await screen.findByRole('menuitemradio', {
      name: 'URL',
      checked: true,
    });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(7);
    fireEvent.keyDown(selected, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    expect(document.activeElement).toBe(trigger);
    expect(
      (screen.getByLabelText('Column name') as HTMLInputElement).value
    ).toBe('Website');
    expect(create).not.toHaveBeenCalled();
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledExactlyOnceWith({
        name: 'Website',
        dataType: 'LINK',
        inferType: false,
        options: [],
      })
    );
  });

  it('hands focus to the new cell only after a successful create', async () => {
    let target!: HTMLInputElement;
    const onCreated = vi.fn(() => {
      target.focus();
      return true;
    });
    render(() => (
      <>
        <PropertyCreator
          existingNames={[]}
          onCreate={async () => {}}
          onCreated={onCreated}
        />
        <input ref={target} aria-label="New cell" />
      </>
    ));
    const trigger = screen.getByRole('button', { name: 'Add column' });
    fireEvent.click(trigger);
    const name = (await screen.findByLabelText(
      'Column name'
    )) as HTMLInputElement;
    fireEvent.submit(name.form!);
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(onCreated).toHaveBeenCalledOnce();
    trigger.focus();
    fireEvent.click(trigger);
    const reopened = await screen.findByLabelText('Column name');
    fireEvent.keyDown(reopened, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it.each([
    { names: ['Name'], expected: 'Unnamed' },
    { names: ['Name', ' unnamed '], expected: 'Unnamed 2' },
    { names: ['Unnamed', 'UNNAMED 2'], expected: 'Unnamed 3' },
  ])(
    'creates $expected without requiring a name',
    async ({ names, expected }) => {
      const create = vi.fn(async () => {});
      render(() => <PropertyCreator existingNames={names} onCreate={create} />);
      fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
      const name = (await screen.findByLabelText(
        'Column name'
      )) as HTMLInputElement;
      await waitFor(() => expect(document.activeElement).toBe(name));
      expect(name.placeholder).toBe('Unnamed');
      expect(name.required).toBe(false);
      expect(
        screen.getByRole('button', { name: 'Column type: Text' })
      ).toBeTruthy();
      fireEvent.input(name, { target: { value: '   ' } });
      expect(name.form!.checkValidity()).toBe(true);
      fireEvent.submit(name.form!);
      await waitFor(() =>
        expect(create).toHaveBeenCalledExactlyOnceWith({
          name: expected,
          dataType: 'STRING',
          inferType: true,
          options: [],
        })
      );
    }
  );

  it.each([true, false])(
    'only locks default Text when it is explicitly selected (%s)',
    async (selectText) => {
      const create = vi.fn(async () => {});
      render(() => <PropertyCreator existingNames={[]} onCreate={create} />);
      fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
      if (selectText) await chooseType('Text');
      else {
        const trigger = screen.getByRole('button', {
          name: 'Column type: Text',
        });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const item = await screen.findByRole('menuitemradio', { name: 'Text' });
        fireEvent.keyDown(item, { key: 'Escape' });
        await waitFor(() =>
          expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
        );
      }
      fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
      await waitFor(() =>
        expect(create).toHaveBeenCalledExactlyOnceWith({
          name: 'Unnamed',
          dataType: 'STRING',
          inferType: !selectText,
          options: [],
        })
      );
    }
  );

  it('validates an explicit unique name and submits select labels together', async () => {
    const create = vi.fn(async () => {});
    render(() => (
      <PropertyCreator existingNames={['Name']} onCreate={create} />
    ));
    const trigger = screen.getByRole('button', { name: 'Add column' });
    fireEvent.click(trigger);
    const name = await screen.findByLabelText('Column name');
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.input(name, { target: { value: ' name ' } });
    expect(
      screen.getByText('A column with this name already exists.')
    ).toBeTruthy();
    fireEvent.input(name, { target: { value: 'Status' } });
    await chooseType('Select');
    expect((name as HTMLInputElement).value).toBe('Status');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Not started option' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove In progress option' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Done option' }));
    const option = screen.getByRole('textbox', { name: 'New option' });
    fireEvent.input(option, {
      target: { value: ' To do,Done, done,In progress' },
    });
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(create).not.toHaveBeenCalled();
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Status',
        dataType: 'SELECT_STRING',
        inferType: false,
        options: ['To do', 'Done', 'In progress'],
      })
    );
    await waitFor(() =>
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    );
  });

  it('preserves the form after a failed create and prevents duplicate submissions while pending', async () => {
    let reject: (error: Error) => void = () => {};
    const create = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    );
    render(() => <PropertyCreator existingNames={[]} onCreate={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const name = await screen.findByLabelText('Column name');
    fireEvent.input(name, { target: { value: 'Budget' } });
    fireEvent.submit(name.closest('form')!);
    fireEvent.submit(name.closest('form')!);
    expect(create).toHaveBeenCalledTimes(1);
    reject(new Error('Network unavailable'));
    await screen.findByRole('alert');
    expect((name as HTMLInputElement).value).toBe('Budget');
  });

  it('keeps the entered name when choosing a type and omits irrelevant select options', async () => {
    const create = vi.fn(async () => {});
    render(() => (
      <PropertyCreator existingNames={['Name']} onCreate={create} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const name = screen.getByLabelText('Column name');
    fireEvent.input(name, { target: { value: 'Budget' } });
    await chooseType('Select');
    expect(screen.getByRole('textbox', { name: 'New option' })).toBeTruthy();
    await chooseType('Number');
    expect((name as HTMLInputElement).value).toBe('Budget');
    expect(screen.queryByRole('textbox', { name: 'New option' })).toBeNull();
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Budget',
        dataType: 'NUMBER',
        inferType: false,
        options: [],
      })
    );
  });

  it('pre-fills board setup and focuses the name when reopened', async () => {
    const create = vi.fn(async () => {});
    render(() => (
      <PropertyCreator
        existingNames={['Name']}
        label="Add Status column"
        initialType="SELECT_STRING"
        onCreate={create}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add Status column' }));
    const first = await screen.findByLabelText('Column name');
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect((first as HTMLInputElement).value).toBe('Status');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Status column' }));
    const reopened = await screen.findByLabelText('Column name');
    await waitFor(() => expect(document.activeElement).toBe(reopened));
    fireEvent.submit(reopened.closest('form')!);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Status',
        dataType: 'SELECT_STRING',
        inferType: false,
        options: ['Not started', 'In progress', 'Done'],
      })
    );
  });
});
