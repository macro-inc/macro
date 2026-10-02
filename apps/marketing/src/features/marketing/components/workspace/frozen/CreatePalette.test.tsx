import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreatePalette } from './CreatePalette';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const email = vi.fn();
  const task = vi.fn();
  const close = vi.fn();
  render(() => (
    <CreatePalette
      mount={document.body}
      onClose={close}
      options={[
        { label: 'Email', key: 'e', icon: () => <svg />, run: email },
        { label: 'Task', key: 't', icon: () => <svg />, run: task },
      ]}
    />
  ));
  return { email, task, close, search: screen.getByRole('combobox') };
}

it('filters options and creates only the selected local item', () => {
  const { task, email, close, search } = setup();
  fireEvent.input(search, { target: { value: 'task' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(task).toHaveBeenCalledOnce();
  expect(email).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('does not create anything for an empty result set', () => {
  const { task, email, close, search } = setup();
  fireEvent.input(search, { target: { value: 'no such option' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(task).not.toHaveBeenCalled();
  expect(email).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
