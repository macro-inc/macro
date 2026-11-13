/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { expect, it } from 'vitest';
import { StepHeader } from './computer-setup-dialog';

it('names the four setup steps in order and marks the current one', () => {
  render(() => <StepHeader step="agent" skipsClaude={false} />);

  const steps = screen.getByRole('list', { name: 'Setup steps' });
  const items = steps.querySelectorAll('li');
  expect([...items].map((item) => item.textContent)).toEqual([
    'Buy computer',
    'Configure agent',
    'Bring your AI',
    'Ready',
  ]);
  expect(items[1].getAttribute('aria-current')).toBe('step');
  expect(items[0].getAttribute('aria-current')).toBeNull();
});

it('strikes Bring your AI when the agent runs on Macro credits', () => {
  render(() => <StepHeader step="ready" skipsClaude />);

  const items = screen
    .getByRole('list', { name: 'Setup steps' })
    .querySelectorAll('li');
  expect(items[2].className).toContain('line-through');
  expect(items[1].className).not.toContain('line-through');
});
