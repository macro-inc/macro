/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { EntityComposer } from './EntityComposer';

const mocks = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/constant/isMac', () => ({ IS_MAC: true }));

afterEach(() => {
  cleanup();
  mocks.touch = false;
});

function renderSubmit() {
  const onClick = vi.fn();
  render(() => (
    <EntityComposer.Footer>
      <EntityComposer.Submit hasContent onClick={onClick}>
        Create Task
      </EntityComposer.Submit>
    </EntityComposer.Footer>
  ));
  return onClick;
}

it('keeps the submit button label free of shortcut text with a keyboard', () => {
  const onClick = renderSubmit();
  const submit = screen.getByRole('button', { name: /Create Task/ });

  expect(submit.textContent).toBe('Create Task');
  fireEvent.click(submit);
  expect(onClick).toHaveBeenCalledOnce();
});

it('leaves the keyboard shortcut off the submit button on touch', () => {
  mocks.touch = true;
  const onClick = renderSubmit();
  const submit = screen.getByRole('button', { name: 'Create Task' });

  expect(submit.textContent).not.toContain('⌘');
  fireEvent.click(submit);
  expect(onClick).toHaveBeenCalledOnce();
});
