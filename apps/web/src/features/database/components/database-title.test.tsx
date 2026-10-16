import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTitle } from './database-title';

afterEach(cleanup);

function setup(name = 'Untitled database', canEdit = true) {
  let edit: (() => void) | undefined;
  const rename = vi.fn();
  render(() => (
    <DatabaseTitle
      name={name}
      canEdit={canEdit}
      onRename={rename}
      onEditReady={(start) => (edit = start)}
    />
  ));
  return { rename, edit: () => edit?.() };
}

describe('database title', () => {
  it('shows a static title without taking focus on open', () => {
    setup();
    expect(screen.getByText('Untitled database')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses and selects the title only when Rename is requested', () => {
    const { edit } = setup();
    edit();
    const input = screen.getByRole('textbox', {
      name: 'Database name',
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Untitled database'.length);
  });

  it('saves on Enter and returns to a static label', () => {
    const { rename, edit } = setup();
    edit();
    const input = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(input, { target: { value: ' Summer offsite ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(rename).toHaveBeenCalledExactlyOnceWith('Summer offsite');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not save Enter while composing the title', () => {
    const { rename, edit } = setup();
    edit();
    const input = screen.getByRole('textbox', { name: 'Database name' });
    fireEvent.input(input, { target: { value: '計画' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('discards the draft on Escape and can reopen Rename', () => {
    const { rename, edit } = setup('Projects');
    edit();
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Draft title' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Projects')).toBeTruthy();
    edit();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Projects'
    );
  });

  it('keeps the title read-only without edit access', () => {
    const { edit } = setup('Shared database', false);
    edit();
    expect(screen.getByText('Shared database')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
