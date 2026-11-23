import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomepageTour } from './HomepageTour';

const reducedMotion = { matches: false };

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion.matches = false;
  vi.stubGlobal('matchMedia', () => reducedMotion);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const selected = (view: ReturnType<typeof render>) =>
  view.getByRole('tab', { selected: true }).textContent;

it('advances on its own until the visitor picks a module', () => {
  const view = render(() => <HomepageTour />);
  expect(selected(view)).toBe('Home');

  vi.advanceTimersByTime(5000);
  expect(selected(view)).toBe('Mail');

  fireEvent.click(view.getByRole('tab', { name: 'Docs' }));
  expect(selected(view)).toBe('Docs');
  vi.advanceTimersByTime(15000);
  expect(selected(view)).toBe('Docs');
});

it('steps forward with Next and wraps from the last module to the first', () => {
  const view = render(() => <HomepageTour />);
  fireEvent.click(view.getByRole('tab', { name: 'Calls' }));
  fireEvent.click(view.getByRole('button', { name: 'Next module' }));
  expect(selected(view)).toBe('Home');
});

it('moves between modules with the arrow keys', () => {
  const view = render(() => <HomepageTour />);
  fireEvent.keyDown(view.getByRole('tablist'), { key: 'ArrowLeft' });
  expect(selected(view)).toBe('Calls');
  expect(document.activeElement).toBe(view.getByRole('tab', { name: 'Calls' }));
});

it('never moves on its own for visitors who prefer reduced motion', () => {
  reducedMotion.matches = true;
  const view = render(() => <HomepageTour />);
  vi.advanceTimersByTime(15000);
  expect(selected(view)).toBe('Home');
});
