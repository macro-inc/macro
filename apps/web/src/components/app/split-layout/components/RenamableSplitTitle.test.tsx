/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenamableSplitTitle } from './RenamableSplitTitle';

const mocks = vi.hoisted(() => ({ touch: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));

function renderTitle() {
  const onRename = vi.fn();
  render(() => (
    <RenamableSplitTitle
      label="Agent Session"
      ariaLabel="Agent session name"
      onRename={onRename}
    />
  ));
  return { onRename };
}

const editor = () =>
  screen.queryByLabelText('Agent session name') as HTMLInputElement | null;

describe('RenamableSplitTitle', () => {
  beforeEach(() => {
    mocks.touch = false;
  });

  it('shows a static title until the user double-clicks it', async () => {
    renderTitle();

    expect(screen.getByText('Agent Session').tagName).toBe('SPAN');
    expect(editor()).toBeNull();

    await userEvent.dblClick(screen.getByText('Agent Session'));

    expect(editor()?.value).toBe('Agent Session');
    expect(document.activeElement).toBe(editor());
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

  it('leaves single clicks to the split chrome', async () => {
    renderTitle();

    await userEvent.click(screen.getByText('Agent Session'));

    expect(editor()).toBeNull();
  });

  it('edits on a single tap where there is no double-click', async () => {
    mocks.touch = true;
    renderTitle();

    await userEvent.click(screen.getByText('Agent Session'));

    expect(editor()?.value).toBe('Agent Session');
  });
});
