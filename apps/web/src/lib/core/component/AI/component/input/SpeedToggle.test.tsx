import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Model } from '../../constant/model';
import { speedForModel } from '../../constant/speed';
import { setFastModeEnabled } from '../../signal/speed';
import { SpeedToggle } from './SpeedToggle';

vi.mock('@ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
const animate = vi.fn(() => ({ cancel: vi.fn() }));
const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'animate'
);
beforeEach(() => {
  setFastModeEnabled(false);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  animate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

it('animates the bolt and retains its paid-speed preference across mounts', () => {
  const view = render(() => <SpeedToggle model={Model.gpt6Astra} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('macro:ai-fast-mode')).toBe('true');
  expect(animate).toHaveBeenCalledOnce();
  view.unmount();
  render(() => <SpeedToggle model={Model.opus55} />);
  expect(screen.getByRole('button').getAttribute('aria-label')).toContain(
    'Fast mode on · 2×'
  );
  expect(speedForModel(Model.opus55, true)).toBe('fast');
});

it('leaves unsupported models at standard speed and respects reduced motion', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true }))
  );
  const view = render(() => <SpeedToggle model={Model.gpt6Astra} />);
  fireEvent.click(screen.getByRole('button'));
  expect(animate).not.toHaveBeenCalled();
  view.unmount();
  render(() => <SpeedToggle model={Model.gemini38Flash} />);
  expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  expect(speedForModel(Model.gemini38Flash, true)).toBe('standard');
});
