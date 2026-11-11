import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createRunWhenCurrent } from './run-when-current';

function setup() {
  const [typed, setTyped] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [open, setOpen] = createSignal(true);
  let dispose = () => {};
  const run = createRoot((cleanup) => {
    dispose = cleanup;
    return createRunWhenCurrent(() => typed() !== query(), open);
  });
  return { run, setTyped, setQuery, setOpen, query, dispose };
}

it('runs at once when the list matches the typed text', () => {
  const menu = setup();
  const action = vi.fn();
  menu.run(action);
  expect(action).toHaveBeenCalledOnce();
  menu.dispose();
});

it('waits for the list to catch up with the typed text, then acts on it', () => {
  const menu = setup();
  const opened: string[] = [];
  menu.setTyped('jacob');
  menu.run(() => opened.push(menu.query()));
  expect(opened).toEqual([]);

  menu.setQuery('jacob');
  expect(opened).toEqual(['jacob']);
  menu.dispose();
});

it('drops a waiting action when the menu closes first', () => {
  const menu = setup();
  const action = vi.fn();
  menu.setTyped('jacob');
  menu.run(action);
  menu.setOpen(false);
  menu.setTyped('');
  menu.setOpen(true);
  expect(action).not.toHaveBeenCalled();
  menu.dispose();
});
