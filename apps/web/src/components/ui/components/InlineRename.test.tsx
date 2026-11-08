import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineRename, RenameInput, RenameTitle } from './InlineRename';

const toast = vi.hoisted(() => ({ failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

afterEach(() => {
  cleanup();
  toast.failure.mockReset();
});

type Table = { id: string; name: string };

function renderTitle(options: {
  rename: (target: Table, name: string) => ResultAsync<unknown, string>;
  validate?: (name: string) => string | undefined;
  startOn?: 'click' | 'double-click';
}) {
  const [table, setTable] = createSignal<Table>({ id: 'tasks', name: 'Tasks' });
  const restoreFocus = vi.fn();
  render(() => {
    const rename = createInlineRename({
      key: (target: Table) => target.id,
      name: (target) => target.name,
      rename: options.rename,
      failureMessage: (failure: string) => failure,
      validate: options.validate,
      restoreFocus,
    });
    return (
      <RenameTitle
        rename={rename}
        target={table()}
        startOn={options.startOn ?? 'double-click'}
        aria-label="Table name"
      />
    );
  });
  return { setTable, restoreFocus };
}

const field = () => screen.getByRole<HTMLInputElement>('textbox');

describe('RenameTitle', () => {
  it('opens on double-click with the whole name selected, and Enter commits the trimmed name', async () => {
    const onRename = vi.fn((_target: Table, _name: string) =>
      okAsync(undefined)
    );
    const { restoreFocus } = renderTitle({ rename: onRename });

    fireEvent.click(screen.getByText('Tasks'));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.dblClick(screen.getByText('Tasks'));

    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('Tasks');
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe('Tasks'.length);

    fireEvent.input(field(), { target: { value: '  Projects ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onRename).toHaveBeenCalledExactlyOnceWith(
      { id: 'tasks', name: 'Tasks' },
      'Projects'
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    await Promise.resolve();
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it('opens a page heading on click and from F2', () => {
    renderTitle({ rename: () => okAsync(undefined), startOn: 'click' });
    fireEvent.click(screen.getByText('Tasks'));
    expect(field().value).toBe('Tasks');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.keyDown(screen.getByText('Tasks'), { key: 'F2' });
    expect(field().value).toBe('Tasks');
  });

  it('restores the name on Escape and treats empty or unchanged names as no-ops', async () => {
    const onRename = vi.fn(() => okAsync(undefined));
    const { restoreFocus } = renderTitle({ rename: onRename });

    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: 'Draft' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.getByText('Tasks')).toBeTruthy();

    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: '   ' } });
    fireEvent.blur(field());
    expect(screen.getByText('Tasks')).toBeTruthy();

    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: ' Tasks ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByText('Tasks')).toBeTruthy();

    expect(onRename).not.toHaveBeenCalled();
    await Promise.resolve();
    // Escape and Enter hand focus back; blur leaves it where the user put it.
    expect(restoreFocus).toHaveBeenCalledTimes(2);
  });

  it('commits on blur', () => {
    const onRename = vi.fn((_target: Table, _name: string) =>
      okAsync(undefined)
    );
    const { restoreFocus } = renderTitle({ rename: onRename });
    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: 'Projects' } });
    fireEvent.blur(field());
    expect(onRename).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it('keeps editing with the reason when validation refuses a name', () => {
    const onRename = vi.fn(() => okAsync(undefined));
    renderTitle({
      rename: onRename,
      validate: (name) =>
        name === 'Projects' ? 'A table with this name exists.' : undefined,
    });
    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: 'Projects' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(screen.getByRole('alert').textContent).toBe(
      'A table with this name exists.'
    );
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.input(field(), { target: { value: 'Projects 2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the new name while the rename is in flight and keeps it once the source catches up', async () => {
    let settle!: () => void;
    const { setTable } = renderTitle({
      rename: () =>
        ResultAsync.fromSafePromise(
          new Promise<void>((resolve) => {
            settle = resolve;
          })
        ),
    });
    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: 'Projects' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByText('Projects')).toBeTruthy();

    setTable({ id: 'tasks', name: 'Projects' });
    settle();
    await new Promise((resolve) => setTimeout(resolve));
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(toast.failure).not.toHaveBeenCalled();
  });

  it('puts the old name back and says why when the rename fails', async () => {
    renderTitle({ rename: () => errAsync('Connection lost') });
    fireEvent.dblClick(screen.getByText('Tasks'));
    fireEvent.input(field(), { target: { value: 'Projects' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve));

    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(toast.failure).toHaveBeenCalledExactlyOnceWith('Connection lost');
  });

  it('cannot be renamed when read-only', () => {
    render(() => {
      const rename = createInlineRename({
        key: (target: Table) => target.id,
        name: (target) => target.name,
        rename: () => okAsync(undefined),
        failureMessage: (failure: string) => failure,
      });
      return (
        <RenameTitle
          rename={rename}
          target={{ id: 'tasks', name: 'Tasks' }}
          startOn="click"
          readOnly
          aria-label="Table name"
        />
      );
    });
    fireEvent.click(screen.getByText('Tasks'));
    fireEvent.keyDown(screen.getByText('Tasks'), { key: 'F2' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('RenameInput', () => {
  it('hands the keyboard on instead of restoring focus when Enter has somewhere to go', async () => {
    const onSubmit = vi.fn();
    const restoreFocus = vi.fn();
    render(() => {
      const rename = createInlineRename({
        key: (target: Table) => target.id,
        name: (target) => target.name,
        rename: () => okAsync(undefined),
        failureMessage: (failure: string) => failure,
        restoreFocus,
      });
      rename.begin({ id: 'due', name: 'Due' });
      return (
        <RenameInput
          rename={rename}
          aria-label="Column name"
          onSubmit={onSubmit}
        />
      );
    });
    fireEvent.input(field(), { target: { value: 'Due date' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(restoreFocus).not.toHaveBeenCalled();
  });
});
