import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { CountBadge } from './Badge';

afterEach(cleanup);

it('shows a count inside its control and nothing at zero', () => {
  const [count, setCount] = createSignal(0);
  render(() => (
    <button type="button" aria-label="Filter tasks">
      <CountBadge count={count()} />
    </button>
  ));
  const button = screen.getByRole('button', { name: 'Filter tasks' });
  expect(button.textContent).toBe('');

  setCount(3);
  expect(button.textContent).toBe('3');

  setCount(140);
  expect(button.textContent).toBe('99+');

  setCount(0);
  expect(button.textContent).toBe('');
});
