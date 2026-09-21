import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTitle } from './database-title';

afterEach(cleanup);

describe('database title', () => {
  it('moves into A1 only after Enter successfully saves the title', async () => {
    let saved!: () => void;
    const rename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        })
    );
    let cell!: HTMLInputElement;
    const enterGrid = vi.fn(() => cell.focus());
    render(() => (
      <>
        <DatabaseTitle
          name="Untitled database"
          canEdit
          autoFocus
          onRename={rename}
          onConfirm={enterGrid}
        />
        <input ref={cell} aria-label="A1" />
      </>
    ));
    const title = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(title, { target: { value: 'Projects' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(enterGrid).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(title);
    saved();
    await waitFor(() => expect(document.activeElement).toBe(cell));
    expect(enterGrid).toHaveBeenCalledTimes(1);
  });

  it('Enter on an unchanged name enters A1, while blur and Escape do not', async () => {
    const enterGrid = vi.fn();
    const rename = vi.fn(async () => {});
    render(() => (
      <DatabaseTitle
        name="Projects"
        canEdit
        autoFocus
        onRename={rename}
        onConfirm={enterGrid}
      />
    ));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(enterGrid).toHaveBeenCalledTimes(1));
    expect(rename).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename database: Projects' })
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(enterGrid).toHaveBeenCalledTimes(1);
  });
  it('focuses and selects a new database title without another click', () => {
    render(() => (
      <DatabaseTitle
        name="Untitled database"
        canEdit
        autoFocus
        onRename={vi.fn(async () => {})}
      />
    ));
    const input = screen.getByRole('textbox', {
      name: 'Database name',
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Untitled database'.length);
  });

  it('does not save Enter while composing the title', () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <DatabaseTitle
        name="Untitled database"
        canEdit
        autoFocus
        onRename={rename}
      />
    ));
    const input = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(input, { target: { value: '計画' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
  it('saves on Enter and returns keyboard focus to the updated title', async () => {
    const [name, setName] = createSignal('Untitled database');
    const rename = vi.fn(async (value: string) => {
      setName(value);
    });
    render(() => <DatabaseTitle name={name()} canEdit onRename={rename} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename database: Untitled database' })
    );
    const input = screen.getByRole('textbox', { name: 'Database name' });
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: ' Summer offsite ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(rename).toHaveBeenCalledExactlyOnceWith('Summer offsite');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Rename database: Summer offsite' })
      )
    );
  });

  it('cancels on Escape without writing and restores the original name', async () => {
    const rename = vi.fn(async () => {});
    render(() => <DatabaseTitle name="Projects" canEdit onRename={rename} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename database: Projects' })
    );
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Draft title' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Rename database: Projects' })
      )
    );
  });

  it('saves when focus leaves the editor without taking focus back', async () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <>
        <DatabaseTitle name="Projects" canEdit onRename={rename} />
        <button type="button">Next control</button>
      </>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename database: Projects' })
    );
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Roadmap' },
    });
    const outside = screen.getByRole('button', { name: 'Next control' });
    outside.focus();
    await waitFor(() =>
      expect(rename).toHaveBeenCalledExactlyOnceWith('Roadmap')
    );
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });

  it('keeps a failed draft and lets the user retry', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(undefined);
    render(() => <DatabaseTitle name="Projects" canEdit onRename={rename} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename database: Projects' })
    );
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Roadmap' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('alert');
    expect((input as HTMLInputElement).value).toBe('Roadmap');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it('does not offer a rename action without edit access', () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <DatabaseTitle name="Shared database" canEdit={false} onRename={rename} />
    ));
    const title = screen.getByRole('button', { name: 'Shared database' });
    expect((title as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(title);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });
});
