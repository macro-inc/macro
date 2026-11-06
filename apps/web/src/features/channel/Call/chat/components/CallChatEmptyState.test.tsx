import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { CallChatEmptyState } from './CallChatEmptyState';

afterEach(cleanup);
it('keeps the shared default graphic size for an empty call discussion', () => {
  const { container } = render(() => <CallChatEmptyState />);
  expect(screen.getByText('Start the conversation.')).toBeTruthy();
  const graphic = container.querySelector('.empty-state-graphic');
  expect(graphic?.classList.contains('h-48')).toBe(true);
  expect(graphic?.classList.contains('w-48')).toBe(true);
  expect(graphic?.classList.contains('size-16')).toBe(false);
});
