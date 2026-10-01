import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchPalette } from './SearchPalette';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
});

it('filters by category and query, then opens the keyboard-selected result', () => {
  const task = vi.fn();
  const agent = vi.fn();
  const close = vi.fn();
  render(() => (
    <SearchPalette
      mount={document.body}
      onClose={close}
      options={[
        {
          id: 'task',
          title: 'Fix deploy',
          category: 'Tasks',
          icon: () => <svg />,
          run: task,
        },
        {
          id: 'agent',
          title: 'Deploy agent',
          category: 'Agents',
          icon: () => <svg />,
          run: agent,
        },
      ]}
    />
  ));
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(
    screen.getByRole('radio', { name: 'Command' }).getAttribute('aria-checked')
  ).toBe('true');
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Tab' });
  fireEvent.input(input, { target: { value: 'deploy' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(agent).toHaveBeenCalledOnce();
  expect(task).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('moves selection with arrow keys and runs only that result', () => {
  const first = vi.fn();
  const second = vi.fn();
  render(() => (
    <SearchPalette
      mount={document.body}
      onClose={() => {}}
      options={[
        {
          id: 'first',
          title: 'First',
          category: 'Files',
          icon: () => <svg />,
          run: first,
        },
        {
          id: 'second',
          title: 'Second',
          category: 'Files',
          icon: () => <svg />,
          run: second,
        },
      ]}
    />
  ));
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});
