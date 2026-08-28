/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineTitleEditor } from './InlineTitleEditor';

const mocks = vi.hoisted(() => ({ touch: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));

function renderEditor(
  props: { onRename?: (name: string) => void; doubleClickToEdit?: boolean } = {}
) {
  const onRename = props.onRename ?? vi.fn();
  render(() => (
    <InlineTitleEditor
      value="Session"
      placeholder="Untitled"
      ariaLabel="Agent session name"
      onRename={onRename}
      doubleClickToEdit={props.doubleClickToEdit}
    />
  ));
  return { onRename };
}

const editor = () =>
  screen.queryByRole('textbox', {
    name: 'Agent session name',
  }) as HTMLInputElement | null;

describe('InlineTitleEditor', () => {
  beforeEach(() => {
    mocks.touch = false;
  });

  it('renders the title with no button affordance', () => {
    renderEditor();

    expect(editor()?.value).toBe('Session');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('commits the edit on Enter', async () => {
    const { onRename } = renderEditor();

    await userEvent.clear(editor() as HTMLInputElement);
    await userEvent.type(editor() as HTMLInputElement, 'Renamed{Enter}');

    expect(onRename).toHaveBeenCalledWith('Renamed');
  });

  it('discards the edit on Escape', async () => {
    const { onRename } = renderEditor();

    await userEvent.type(editor() as HTMLInputElement, ' draft{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(editor()?.value).toBe('Session');
  });

  it('drops blank and unchanged edits', async () => {
    const { onRename } = renderEditor();
    const input = editor() as HTMLInputElement;

    await userEvent.clear(input);
    await userEvent.type(input, '   {Enter}');
    await userEvent.clear(input);
    await userEvent.type(input, 'Session{Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });

  describe('doubleClickToEdit', () => {
    it('shows a static title until the user double-clicks it', async () => {
      renderEditor({ doubleClickToEdit: true });

      expect(
        screen.getByRole('button', { name: 'Agent session name' }).textContent
      ).toBe('Session');
      expect(editor()).toBeNull();

      await userEvent.dblClick(
        screen.getByRole('button', { name: 'Agent session name' })
      );

      expect(editor()?.value).toBe('Session');
      expect(document.activeElement).toBe(editor());
    });

    it('leaves single clicks to surrounding chrome', async () => {
      renderEditor({ doubleClickToEdit: true });

      await userEvent.click(
        screen.getByRole('button', { name: 'Agent session name' })
      );

      expect(editor()).toBeNull();
    });

    it('edits on a single tap where there is no double-click', async () => {
      mocks.touch = true;
      renderEditor({ doubleClickToEdit: true });

      await userEvent.click(
        screen.getByRole('button', { name: 'Agent session name' })
      );

      expect(editor()?.value).toBe('Session');
    });

    it('starts editing from the keyboard', async () => {
      renderEditor({ doubleClickToEdit: true });

      screen.getByRole('button', { name: 'Agent session name' }).focus();
      await userEvent.keyboard('{Enter}');

      expect(document.activeElement).toBe(editor());
    });

    it('renames on Enter and returns to the static title', async () => {
      const onRename = vi.fn();
      render(() => {
        const [value, setValue] = createSignal('Session');
        return (
          <InlineTitleEditor
            value={value()}
            placeholder="Untitled"
            ariaLabel="Agent session name"
            onRename={(name) => {
              onRename(name);
              setValue(name);
            }}
            doubleClickToEdit
          />
        );
      });

      await userEvent.dblClick(
        screen.getByRole('button', { name: 'Agent session name' })
      );
      const input = editor() as HTMLInputElement;
      await userEvent.clear(input);
      await userEvent.type(input, 'Ship the thing{Enter}');

      expect(onRename).toHaveBeenCalledWith('Ship the thing');
      expect(editor()).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Agent session name' }).textContent
      ).toBe('Ship the thing');
    });

    it('does not let a double-click on the editor reach parent chrome', async () => {
      const onParentDblClick = vi.fn();
      render(() => (
        <div onDblClick={onParentDblClick}>
          <InlineTitleEditor
            value="Session"
            placeholder="Untitled"
            ariaLabel="Agent session name"
            onRename={vi.fn()}
            doubleClickToEdit
          />
        </div>
      ));

      await userEvent.dblClick(
        screen.getByRole('button', { name: 'Agent session name' })
      );
      await userEvent.dblClick(editor() as HTMLInputElement);

      expect(onParentDblClick).not.toHaveBeenCalled();
    });
  });
});
