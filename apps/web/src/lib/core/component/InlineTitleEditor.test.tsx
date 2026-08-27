import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineTitleEditor } from './InlineTitleEditor';

function renderEditor(
  props: {
    onRename?: (name: string) => void;
    autofocus?: boolean;
    onExit?: () => void;
  } = {}
) {
  render(() => (
    <InlineTitleEditor
      value="Session"
      placeholder="Untitled"
      ariaLabel="Agent session name"
      onRename={props.onRename ?? vi.fn()}
      autofocus={props.autofocus}
      onExit={props.onExit}
    />
  ));
  return screen.getByLabelText('Agent session name') as HTMLInputElement;
}

describe('InlineTitleEditor', () => {
  it('renders the title with no button affordance', () => {
    const input = renderEditor();

    expect(input.value).toBe('Session');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('commits the edit on Enter', async () => {
    const onRename = vi.fn();
    const input = renderEditor({ onRename });

    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');

    expect(onRename).toHaveBeenCalledWith('Renamed');
  });

  it('discards the edit on Escape', async () => {
    const onRename = vi.fn();
    const input = renderEditor({ onRename });

    await userEvent.type(input, ' draft{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(input.value).toBe('Session');
  });

  it('drops blank and unchanged edits', async () => {
    const onRename = vi.fn();
    const input = renderEditor({ onRename });

    await userEvent.clear(input);
    await userEvent.type(input, '   {Enter}');
    await userEvent.clear(input);
    await userEvent.type(input, 'Session{Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });

  it('focuses and selects the name when autofocused, then reports exit', async () => {
    const onExit = vi.fn();
    const input = renderEditor({ autofocus: true, onExit });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Session'.length);

    await userEvent.keyboard('{Enter}');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
