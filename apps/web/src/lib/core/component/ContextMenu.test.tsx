import { ContextMenu } from '@kobalte/core/context-menu';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Portal } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
} from './ContextMenu';

afterEach(cleanup);

it('opens for the trigger’s own content but not for portaled descendants', async () => {
  render(() => (
    <ContextMenu>
      <ContextMenuTrigger>
        <span>Row</span>
        <Portal>
          <button type="button">Editor</button>
        </Portal>
      </ContextMenuTrigger>
      <ContextMenu.Portal>
        <ContextMenuContent>
          <MenuItem text="Rename" />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  ));

  // A portaled editor keeps the browser's own menu.
  expect(fireEvent.contextMenu(screen.getByText('Editor'))).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();

  expect(fireEvent.contextMenu(screen.getByText('Row'))).toBe(false);
  expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeTruthy();
});
