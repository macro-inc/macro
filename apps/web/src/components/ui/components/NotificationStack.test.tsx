import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationStack } from './NotificationStack';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps only the front card interactive until Show all is pressed', () => {
  const first = vi.fn();
  const second = vi.fn();
  render(() => (
    <NotificationStack
      label="Agent updates"
      title="2 updates"
      items={[{ id: 'first' }, { id: 'second' }]}
      itemKey={(item) => item.id}
    >
      {(item) => (
        <button onClick={item.id === 'first' ? first : second}>
          {item.id}
        </button>
      )}
    </NotificationStack>
  ));
  const region = screen.getByRole('region', { name: 'Agent updates' });
  const toggle = screen.getByRole('button', { name: 'Show all' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-controls')).toBe(
    region.querySelector('div[id]')?.id
  );
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(region.querySelectorAll('article')[1]?.inert).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'first' }));
  expect(first).toHaveBeenCalledOnce();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(toggle);
  expect(
    screen
      .getByRole('button', { name: 'Show less' })
      .getAttribute('aria-expanded')
  ).toBe('true');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(region.querySelectorAll('article')[1]?.inert).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'second' }));
  expect(second).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(
    screen
      .getByRole('button', { name: 'Show all' })
      .getAttribute('aria-expanded')
  ).toBe('false');
});

it('expands from the stack body but not from an action inside the front card', () => {
  const action = vi.fn();
  render(() => (
    <NotificationStack
      label="Agent updates"
      title="2 updates"
      items={[1, 2]}
      itemKey={String}
    >
      {(item) => (
        <div>
          <span>Update {item}</span>
          <button onClick={action}>Act</button>
        </div>
      )}
    </NotificationStack>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Act' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  fireEvent.click(screen.getByText('Update 1'));
  expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
});

it('closes and hides the toggle when one item remains', () => {
  const [items, setItems] = createSignal([1, 2]);
  render(() => (
    <NotificationStack
      label="Agent updates"
      title="Updates"
      items={items()}
      itemKey={String}
    >
      {(item) => <span>Update {item}</span>}
    </NotificationStack>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  setItems([1]);
  expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

it('renders nothing for an empty list', () => {
  const [items, setItems] = createSignal<number[]>([]);
  const { container } = render(() => (
    <NotificationStack
      label="Agent updates"
      title="Updates"
      items={items()}
      itemKey={String}
    >
      {(item) => <span>{item}</span>}
    </NotificationStack>
  ));
  expect(container.querySelector('section')).toBeNull();
  setItems([1]);
  expect(screen.getByRole('region', { name: 'Agent updates' })).toBeTruthy();
  setItems([]);
  expect(container.querySelector('section')).toBeNull();
});
