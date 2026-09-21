import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseMention } from '../core/column-inference';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import {
  type DatabaseMentionPickerProps,
  GridCell,
  type GridCellControl,
} from './GridCell';

const column: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  options: [],
  isMultiSelect: false,
  writable: true,
};
beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = '[role="menu"] { animation-name: none; }';
  document.head.append(style);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  vi.restoreAllMocks();
});

const mention: DatabaseMention = {
  id: 'user-1',
  entityType: 'USER',
  label: 'Maya',
};
function MentionPicker(props: DatabaseMentionPickerProps) {
  let input!: HTMLInputElement;
  onMount(() => input.focus());
  return (
    <div role="dialog" aria-label="Choose linked item">
      <input
        ref={input}
        aria-label="Find an item"
        value={props.search}
        onInput={(event) => props.onSearchChange?.(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            props.onSelect(
              mention,
              event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : undefined
            );
          }
        }}
      />
    </div>
  );
}

describe('grid cell', () => {
  it.each(['STRING', 'SELECT_STRING'])(
    'lets Tab leave a %s editor at a grid boundary',
    async (dataType) => {
      let control: GridCellControl | undefined;
      render(() => (
        <>
          <button type="button">Before grid</button>
          <GridCell
            column={{ ...column, dataType, options: ['Original', 'Done'] }}
            value="Original"
            canEdit
            onWrite={vi.fn(async () => true)}
            onAddOption={vi.fn(async () => true)}
            onReady={(ready) => {
              control = ready;
            }}
            onNavigate={() => false}
          />
          <button type="button">After grid</button>
        </>
      ));
      control?.edit();
      if (dataType === 'SELECT_STRING')
        (await screen.findByRole('menuitem', { name: 'Done' })).focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'After grid' })
      );
      control?.edit();
      if (dataType === 'SELECT_STRING')
        (await screen.findByRole('menuitem', { name: 'Done' })).focus();
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Before grid' })
      );
    }
  );

  it('focuses the read-only boolean wrapper without enabling its checkbox', () => {
    let control: GridCellControl | undefined;
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, dataType: 'BOOLEAN' }}
        value={1}
        canEdit={false}
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onReady={(ready) => {
          control = ready;
        }}
      />
    ));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    control?.focus();
    expect(checkbox.disabled).toBe(true);
    expect(document.activeElement).toBe(checkbox.parentElement);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('shows Unnamed for an empty title without saving placeholder text', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={column}
        value={null}
        emptyLabel="Unnamed"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    const button = screen.getByRole('button', {
      name: 'Name: Unnamed. Click to edit',
    });
    expect(button.textContent).toBe('Unnamed');
    fireEvent.click(button);
    const input = screen.getByRole('textbox', {
      name: 'Edit Name',
    }) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Unnamed');
    fireEvent.keyDown(input, { key: 'Enter' });
    await Promise.resolve();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('opens an inferred text mention without a blur write and restores its search draft on Escape', async () => {
    const onWrite = vi.fn(async () => true);
    const onMention = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, inferType: true }}
        value={null}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onMention={onMention}
        renderMentionPicker={(props) => <MentionPicker {...props} />}
      />
    ));
    const button = screen.getByRole('button', { name: /Name: Empty/ });
    button.focus();
    fireEvent.keyDown(button, { key: '@' });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.input(search, { target: { value: 'Maya' } });
    expect(onWrite).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    const draft = screen.getByRole('textbox', {
      name: 'Edit Name',
    }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(draft));
    expect(draft.value).toBe('@Maya');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onWrite).not.toHaveBeenCalled();
    expect(onMention).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('keeps explicit text columns as literal text when @ is typed', async () => {
    const onWrite = vi.fn(async () => true);
    const picker = vi.fn((props: DatabaseMentionPickerProps) => (
      <MentionPicker {...props} />
    ));
    render(() => (
      <GridCell
        column={{ ...column, inferType: false }}
        value={null}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onMention={vi.fn(async () => true)}
        renderMentionPicker={picker}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: '@Maya' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledExactlyOnceWith('@Maya')
    );
    expect(picker).not.toHaveBeenCalled();
  });

  it('keeps focus on the clicked control when the mention picker closes from outside', async () => {
    let picker: DatabaseMentionPickerProps | undefined;
    const onWrite = vi.fn(async () => true);
    render(() => (
      <>
        <GridCell
          column={{ ...column, inferType: true }}
          value={null}
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onMention={vi.fn(async () => true)}
          renderMentionPicker={(props) => {
            picker = props;
            return <MentionPicker {...props} />;
          }}
        />
        <button type="button" onClick={() => picker?.onClose(false)}>
          Another cell
        </button>
      </>
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    fireEvent.input(search, { target: { value: 'Maya' } });
    const another = screen.getByRole('button', { name: 'Another cell' });
    await userEvent.click(another);
    expect(document.activeElement).toBe(another);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'Edit Name' }) as HTMLInputElement)
        .value
    ).toBe('@Maya');
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('selects a mention with Tab and immediately edits the next field without saving raw text', async () => {
    const onWrite = vi.fn(async () => true);
    const onMention = vi.fn(async () => true);
    let next: GridCellControl | undefined;
    render(() => (
      <>
        <GridCell
          column={{ ...column, inferType: true }}
          value={null}
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onMention={onMention}
          renderMentionPicker={(props) => <MentionPicker {...props} />}
          onNavigate={(direction) => {
            if (direction !== 1) return false;
            next?.edit();
            return true;
          }}
        />
        <GridCell
          column={{ ...column, id: 'notes', name: 'Notes' }}
          value={null}
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onReady={(ready) => {
            next = ready;
          }}
        />
      </>
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    search.focus();
    await userEvent.tab();
    const input = await screen.findByRole('textbox', { name: 'Edit Notes' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(onMention).toHaveBeenCalledExactlyOnceWith(mention);
    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders an entity label, opens its picker, cancels unchanged and clears with Delete', async () => {
    const onWrite = vi.fn(async () => true);
    const onMention = vi.fn(async () => true);
    const renderValue = vi.fn(() => <span>Maya</span>);
    render(() => (
      <GridCell
        column={{ ...column, dataType: 'ENTITY', specificEntityType: 'USER' }}
        value="user-1"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onMention={onMention}
        renderMentionValue={renderValue}
        renderMentionPicker={(props) => <MentionPicker {...props} />}
      />
    ));
    const button = screen.getByRole('button', {
      name: 'Name: Maya',
    });
    expect(button.textContent).toBe('Name: Maya');
    expect(button.getAttribute('aria-description')).toBe('Click to edit');
    expect(button.title).toBe('');
    expect(renderValue).toHaveBeenCalledWith('user-1', 'USER');
    fireEvent.click(button);
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    search.focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(onWrite).not.toHaveBeenCalled();
    expect(onMention).not.toHaveBeenCalled();
    await userEvent.keyboard('{Delete}');
    expect(onWrite).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('keeps the selected label through a delayed write and hands it to the entity renderer when the schema arrives', async () => {
    const [value, setValue] = createSignal<DatabaseCellValue>(null);
    const [schema, setSchema] = createSignal<DatabaseViewColumn>({
      ...column,
      inferType: true,
    });
    let finishWrite!: () => void;
    const written = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const onMention = vi.fn(async (selected: DatabaseMention) => {
      await written;
      setValue(selected.id);
      return true;
    });
    render(() => (
      <GridCell
        column={schema()}
        value={value()}
        canEdit
        onWrite={vi.fn(async () => true)}
        onAddOption={vi.fn(async () => true)}
        onMention={onMention}
        renderMentionPicker={(props) => <MentionPicker {...props} />}
        renderMentionValue={(id) => (
          <span>{id === mention.id ? 'Maya from cache' : 'Avery'}</span>
        )}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /Name: Maya/ }).textContent).toBe(
      'Maya'
    );
    expect(value()).toBeNull();
    finishWrite();
    await waitFor(() => expect(value()).toBe(mention.id));
    expect(screen.getByRole('button', { name: /Name: Maya/ }).textContent).toBe(
      'Maya'
    );
    setSchema({
      ...column,
      dataType: 'ENTITY',
      specificEntityType: 'USER',
    });
    expect(
      screen.getByRole('button', { name: 'Name: Maya from cache' }).textContent
    ).toBe('Name: Maya from cache');
    setValue('user-2');
    expect(
      screen.getByRole('button', { name: 'Name: Avery' }).textContent
    ).toBe('Name: Avery');
  });

  it('exposes the full resolved mention name to assistive technology in read-only cells', () => {
    const [label, setLabel] = createSignal('Person');
    render(() => (
      <GridCell
        column={{
          ...column,
          name: 'Owner',
          dataType: 'ENTITY',
          specificEntityType: 'USER',
        }}
        value="user-1"
        canEdit={false}
        onWrite={vi.fn(async () => true)}
        onAddOption={vi.fn(async () => true)}
        renderMentionValue={() => <span class="truncate">{label()}</span>}
      />
    ));
    const button = screen.getByRole('button', { name: 'Owner: Person' });
    setLabel('a.long.person.name@example.com');
    expect(
      screen.getByRole('button', {
        name: 'Owner: a.long.person.name@example.com',
      })
    ).toBe(button);
    expect(button.getAttribute('aria-description')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps a failed mention draft readable and clears its label when the cell value changes', async () => {
    const [value, setValue] = createSignal<DatabaseCellValue>(null);
    const onMention = vi.fn(async (selected: DatabaseMention) => {
      setValue(selected.id);
      return false;
    });
    render(() => (
      <GridCell
        column={{ ...column, inferType: true }}
        value={value()}
        canEdit
        onWrite={vi.fn(async () => true)}
        onAddOption={vi.fn(async () => true)}
        onMention={onMention}
        renderMentionPicker={(props) => <MentionPicker {...props} />}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(onMention).toHaveResolvedWith(false));
    expect(screen.getByRole('button', { name: /Name: Maya/ }).textContent).toBe(
      'Maya'
    );
    setValue(null);
    expect(
      screen.getByRole('button', { name: /Name: Empty/ }).textContent
    ).toBe('—');
    setValue('Avery');
    expect(
      screen.getByRole('button', { name: /Name: Avery/ }).textContent
    ).toBe('Avery');
    expect(screen.queryByText('Maya')).toBeNull();
  });

  it('lets a new text edit replace a failed mention before its value is acknowledged', async () => {
    const onMention = vi.fn(async () => false);
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, inferType: true }}
        value={null}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onMention={onMention}
        renderMentionPicker={(props) => <MentionPicker {...props} />}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: '@',
    });
    const search = await screen.findByRole('textbox', { name: 'Find an item' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(onMention).toHaveResolvedWith(false));
    const button = screen.getByRole('button', { name: /Name: Maya/ });
    expect(button.textContent).toBe('Maya');
    fireEvent.keyDown(button, { key: 'A' });
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onWrite).toHaveBeenCalledExactlyOnceWith('A'));
    expect(screen.queryByText('Maya')).toBeNull();
  });

  it('starts typing with the pressed character and saves a one-character replacement', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={column}
        value="Original"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    const cell = screen.getByRole('button', { name: /Name: Original/ });
    cell.focus();
    fireEvent.keyDown(cell, { key: 'A' });
    const input = screen.getByRole('textbox', {
      name: 'Edit Name',
    }) as HTMLInputElement;
    expect(input.value).toBe('A');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onWrite).toHaveBeenCalledExactlyOnceWith('A'));
  });

  it('commits Tab and Shift+Tab directly into the adjacent editor', async () => {
    const onWrite = vi.fn(async () => true);
    let first: GridCellControl | undefined;
    let next: GridCellControl | undefined;
    render(() => (
      <>
        <GridCell
          column={column}
          value="Original"
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onReady={(control) => {
            first = control;
          }}
          onNavigate={(direction) => {
            if (direction !== 1 || !next) return false;
            next.edit();
            return true;
          }}
        />
        <GridCell
          column={{ ...column, id: 'notes', name: 'Notes' }}
          value="Old notes"
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onReady={(control) => {
            next = control;
          }}
          onNavigate={(direction) => {
            if (direction !== -1 || !first) return false;
            first.edit();
            return true;
          }}
        />
      </>
    ));
    first?.edit('A');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit Name' }), {
      key: 'Tab',
    });
    const notes = screen.getByRole('textbox', {
      name: 'Edit Notes',
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(notes);
    expect(notes.selectionEnd).toBe(notes.value.length);
    await waitFor(() => expect(onWrite).toHaveBeenCalledExactlyOnceWith('A'));
    fireEvent.input(notes, { target: { value: 'New notes' } });
    fireEvent.keyDown(notes, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Edit Name' })
    );
    await waitFor(() => expect(onWrite).toHaveBeenLastCalledWith('New notes'));
  });

  it('does not commit or cancel while an IME is composing', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={column}
        value={null}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: Empty/ }), {
      key: 'Process',
      isComposing: true,
    });
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.input(input, { target: { value: '企画' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Edit Name' })).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledExactlyOnceWith('企画')
    );
  });

  it('keeps an invalid numeric draft focused instead of navigating on Tab', () => {
    const onWrite = vi.fn(async () => true);
    const onNavigate = vi.fn(() => true);
    render(() => (
      <GridCell
        column={{ ...column, dataType: 'NUMBER' }}
        value={12}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
        onNavigate={onNavigate}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: /Name: 12/ }), {
      key: 'x',
    });
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid number');
    expect(document.activeElement).toBe(input);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('opens a select through its editor control and tabs directly to a text field', async () => {
    let select: GridCellControl | undefined;
    let next: GridCellControl | undefined;
    const onWrite = vi.fn(async () => true);
    render(() => (
      <>
        <GridCell
          column={{
            ...column,
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            options: ['To do', 'Done'],
          }}
          value="To do"
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onReady={(control) => {
            select = control;
          }}
          onNavigate={() => {
            next?.edit();
            return true;
          }}
        />
        <GridCell
          column={column}
          value="Original"
          canEdit
          onWrite={vi.fn(async () => true)}
          onAddOption={vi.fn(async () => true)}
          onReady={(control) => {
            next = control;
          }}
        />
      </>
    ));
    select?.edit();
    const option = await screen.findByRole('menuitem', { name: 'Done' });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Search Status options' })
      )
    );
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(option);
    await userEvent.tab();
    const input = await screen.findByRole('textbox', { name: 'Edit Name' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(
      screen
        .getByRole('button', { name: 'Status: To do' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(onWrite).toHaveBeenCalledExactlyOnceWith('Done');
  });

  it('saves a typed select match with Tab and sends ArrowDown to the matching choice', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <>
        <GridCell
          column={{
            ...column,
            dataType: 'SELECT_STRING',
            options: ['To do', 'Done'],
          }}
          value="To do"
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
          onNavigate={() => false}
        />
        <button>After grid</button>
      </>
    ));
    screen.getByRole('button', { name: 'Name: To do' }).focus();
    await userEvent.keyboard('Done');
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Search Name options',
        }) as HTMLInputElement
      ).value
    ).toBe('Done');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Done' })
    );
    await userEvent.keyboard('{Escape}Done{Tab}');
    expect(onWrite).toHaveBeenCalledExactlyOnceWith('Done');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'After grid' })
    );
  });

  it('filters select options from typed text and commits the matching option', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{
          ...column,
          name: 'Status',
          dataType: 'SELECT_STRING',
          options: ['To do', 'Done'],
        }}
        value="To do"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Status: To do' }), {
      key: 'D',
    });
    const input = (await screen.findByRole('textbox', {
      name: 'Search Status options',
    })) as HTMLInputElement;
    expect(input.value).toBe('D');
    fireEvent.input(input, { target: { value: 'Done' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledExactlyOnceWith('Done')
    );
  });

  it('canonicalizes a new numeric option before saving its SQL label', async () => {
    const onAddOption = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, dataType: 'SELECT_NUMBER', options: ['2'] }}
        value="2"
        canEdit
        onWrite={vi.fn(async () => true)}
        onAddOption={onAddOption}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Name: 2' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Add option' }),
      { key: 'Enter' }
    );
    fireEvent.input(
      await screen.findByRole('textbox', { name: 'New option' }),
      { target: { value: '1.0' } }
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New option' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(onAddOption).toHaveBeenCalledWith('1'));
  });

  it('focuses a new select option after closing the menu and saves through the option action', async () => {
    const onAddOption = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{
          ...column,
          dataType: 'SELECT_STRING',
          options: ['To do', 'Done'],
        }}
        value="To do"
        canEdit
        onWrite={vi.fn(async () => true)}
        onAddOption={onAddOption}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Name: To do' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Add option' }),
      { key: 'Enter' }
    );
    const input = await screen.findByRole('textbox', { name: 'New option' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.input(input, { target: { value: 'In review' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onAddOption).toHaveBeenCalledWith('In review'));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Name: To do' })
      )
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('edits with Enter, restores focus, and saves the exact text', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={column}
        value="Old name"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Old name/ }));
    const input = screen.getByRole('textbox', { name: 'Edit Name' });
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: "O'Reilly's launch" } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onWrite).toHaveBeenCalledWith("O'Reilly's launch")
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Name: Old name/ })
    );
  });

  it('cancels with Escape without writing and does not write an unchanged edit', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={column}
        value="Old name"
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Old name/ }));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Discard me' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Name: Old name/ }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await Promise.resolve();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('does not take focus back after blur saves a cell', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <>
        <GridCell
          column={column}
          value="Old name"
          canEdit
          onWrite={onWrite}
          onAddOption={vi.fn(async () => true)}
        />
        <button type="button">Next field</button>
      </>
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: Old name/ }));
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'New name' } });
    screen.getByRole('button', { name: 'Next field' }).focus();
    await waitFor(() => expect(onWrite).toHaveBeenCalledWith('New name'));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Next field' })
    );
  });

  it('rejects an invalid number without silently clearing it', async () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, dataType: 'NUMBER' }}
        value={12}
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Name: 12/ }));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'twelve' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid number');
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('does not let viewers or multi-select values use a scalar editor', () => {
    const onWrite = vi.fn(async () => true);
    render(() => (
      <GridCell
        column={{ ...column, isMultiSelect: true }}
        value='["one","two"]'
        canEdit
        onWrite={onWrite}
        onAddOption={vi.fn(async () => true)}
      />
    ));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button').textContent).toContain('one, two');
    expect(onWrite).not.toHaveBeenCalled();
  });
});
