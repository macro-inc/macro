import { Tabs } from '@kobalte/core/tabs';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';
import { TabSelector } from './TabSelector';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps add actions separate from the tab selection', async () => {
  const select = vi.fn();
  const create = vi.fn();
  render(() => (
    <TabSelector>
      <Tabs value="books" onChange={select}>
        <TabSelector.List aria-label="Tables">
          <TabSelector.Tab value="books">Books</TabSelector.Tab>
        </TabSelector.List>
      </Tabs>
      <TabSelector.AddMenu label="Add">
        <Dropdown.Item onSelect={create}>New table</Dropdown.Item>
      </TabSelector.AddMenu>
    </TabSelector>
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitem', { name: 'New table' }),
    { key: 'Enter' }
  );
  expect(create).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});

it('scrolls with the wheel and arrows without moving the add menu', async () => {
  render(() => (
    <TabSelector>
      <Tabs value="books">
        <TabSelector.List aria-label="Tables">
          <TabSelector.Tab value="books">Books</TabSelector.Tab>
        </TabSelector.List>
      </Tabs>
      <TabSelector.AddMenu label="Add">
        <Dropdown.Item>New table</Dropdown.Item>
      </TabSelector.AddMenu>
    </TabSelector>
  ));
  const rail = screen.getByRole('tablist');
  Object.defineProperties(rail, {
    clientWidth: { value: 100 },
    scrollWidth: { value: 400 },
  });
  fireEvent.scroll(rail);
  await screen.findByRole('button', { name: 'Scroll tabs right' });
  expect(
    screen
      .getByRole('button', { name: 'Scroll tabs left' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
  expect(rail.scrollLeft).toBe(75);
  fireEvent.wheel(rail, { deltaY: 50 });
  expect(rail.scrollLeft).toBe(125);
  rail.scrollLeft = 300;
  fireEvent.scroll(rail);
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Scroll tabs right' })
        .hasAttribute('disabled')
    ).toBe(true)
  );
  expect(rail.contains(screen.getByRole('button', { name: 'Add' }))).toBe(
    false
  );
});
