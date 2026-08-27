/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { RenamableSplitTitle } from './RenamableSplitTitle';

function renderTitle() {
  const editing = createSignal(false);
  const onRename = vi.fn();
  render(() => (
    <RenamableSplitTitle
      label="Agent Session"
      ariaLabel="Agent session name"
      onRename={onRename}
      editing={editing}
    />
  ));
  return { editing, onRename };
}

const editor = () =>
  screen.queryByLabelText('Agent session name') as HTMLInputElement | null;

describe('RenamableSplitTitle', () => {
  it('shows a static title until the user double-clicks it', async () => {
    renderTitle();

    expect(screen.getByText('Agent Session').tagName).toBe('SPAN');
    expect(editor()).toBeNull();

    await userEvent.dblClick(screen.getByText('Agent Session'));

    expect(editor()?.value).toBe('Agent Session');
  });

  it('renames on Enter and returns to the static title', async () => {
    const { onRename } = renderTitle();

    await userEvent.dblClick(screen.getByText('Agent Session'));
    const input = editor() as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Ship the thing{Enter}');

    expect(onRename).toHaveBeenCalledWith('Ship the thing');
    expect(editor()).toBeNull();
  });

  it('opens the editor when the caller sets its edit state', async () => {
    const { editing } = renderTitle();

    editing[1](true);

    expect(await screen.findByLabelText('Agent session name')).toBeDefined();
  });

  it('leaves single clicks to the split chrome', async () => {
    renderTitle();

    await userEvent.click(screen.getByText('Agent Session'));

    expect(editor()).toBeNull();
  });
});
