import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTitle } from './database-title';

afterEach(cleanup);

describe('database title', () => {
  it('focuses and selects a new database title without another click', () => {
    render(() => (
      <DatabaseTitle
        name="Untitled database"
        canEdit
        autoFocus
        onRename={vi.fn()}
      />
    ));
    const input = screen.getByRole('textbox', {
      name: 'Database name',
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Untitled database'.length);
  });

  it('saves on Enter and then enters the grid', async () => {
    const rename = vi.fn();
    const enterGrid = vi.fn();
    render(() => (
      <DatabaseTitle
        name="Untitled database"
        canEdit
        autoFocus
        onRename={rename}
        onConfirm={enterGrid}
      />
    ));
    const input = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(input, { target: { value: ' Summer offsite ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(rename).toHaveBeenCalledExactlyOnceWith('Summer offsite');
    await Promise.resolve();
    expect(enterGrid).toHaveBeenCalledTimes(1);
  });

  it('does not save Enter while composing the title', () => {
    const rename = vi.fn();
    const enterGrid = vi.fn();
    render(() => (
      <DatabaseTitle
        name="Untitled database"
        canEdit
        autoFocus
        onRename={rename}
        onConfirm={enterGrid}
      />
    ));
    const input = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(input, { target: { value: '計画' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(rename).not.toHaveBeenCalled();
    expect(enterGrid).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('discards the draft on Escape without entering the grid', async () => {
    const rename = vi.fn();
    const enterGrid = vi.fn();
    render(() => (
      <DatabaseTitle
        name="Projects"
        canEdit
        autoFocus
        onRename={rename}
        onConfirm={enterGrid}
      />
    ));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Draft title' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await Promise.resolve();
    expect(rename).not.toHaveBeenCalled();
    expect(enterGrid).not.toHaveBeenCalled();
    expect(input.value).toBe('Projects');
  });

  it('focuses the title when the host asks to rename', () => {
    let edit: (() => void) | undefined;
    render(() => (
      <DatabaseTitle
        name="Projects"
        canEdit
        onRename={vi.fn()}
        onEditReady={(start) => (edit = start)}
      />
    ));
    edit?.();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Database name' })
    );
  });

  it('shows a plain name without edit access', () => {
    render(() => (
      <DatabaseTitle
        name="Shared database"
        canEdit={false}
        onRename={vi.fn()}
      />
    ));
    expect(screen.getByText('Shared database')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
