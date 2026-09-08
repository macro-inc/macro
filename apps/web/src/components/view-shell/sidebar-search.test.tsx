/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import {
  createSidebarSearch,
  SidebarSearchField,
  SidebarSearchToggle,
} from './sidebar-search';

afterEach(cleanup);

it('focuses search, restores navigation and clears the query on Escape', async () => {
  const screen = render(() => {
    const search = createSidebarSearch();
    return (
      <>
        <SidebarSearchToggle search={search} label="Search folders" />
        <Show when={search.isOpen()} fallback={<nav>Folder tree</nav>}>
          <SidebarSearchField search={search} label="Search folders" />
        </Show>
      </>
    );
  });
  const trigger = screen.getByRole('button', { name: 'Search folders' });
  fireEvent.click(trigger);
  const input = screen.getByRole('searchbox');
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.input(input, { target: { value: 'Planning' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('navigation').textContent).toBe('Folder tree');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Close sidebar search' }));
  expect(screen.queryByRole('searchbox')).toBeNull();
});
