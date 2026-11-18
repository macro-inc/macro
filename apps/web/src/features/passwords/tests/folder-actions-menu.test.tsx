import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type JSX, splitProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderActionsMenu } from '../components/folder-actions-menu';

// Tooltips never open under test, so stand in a marker for each one a button
// would show.
vi.mock('@ui/components/Tooltip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui/components/Tooltip')>()),
  Tooltip: {
    Root: (props: { children: JSX.Element }) => (
      <>
        {props.children}
        <span data-testid="tooltip" />
      </>
    ),
    Trigger: (props: { as: ValidComponent }) => {
      const [local, rest] = splitProps(props, ['as']);
      return <Dynamic component={local.as} {...rest} />;
    },
    Portal: () => null,
    Content: () => null,
  },
}));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('names the folder for assistive tech without a tooltip that would cover its menu', async () => {
  const onSubfolder = vi.fn();
  render(() => (
    <FolderActionsMenu
      name="Engineering"
      onSubfolder={onSubfolder}
      onRename={vi.fn()}
      onMove={vi.fn()}
      onDelete={vi.fn()}
    />
  ));
  const trigger = screen.getByRole('button', {
    name: 'Folder actions for Engineering',
  });
  expect(screen.queryByTestId('tooltip')).toBeNull();

  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(
    await screen.findByRole('menuitem', { name: 'New subfolder' })
  );
  expect(onSubfolder).toHaveBeenCalledOnce();
});
