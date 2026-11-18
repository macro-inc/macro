/** @vitest-environment jsdom */

import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Model } from '../../constant/model';
import { nativeSpeeds, speedForModel } from '../../constant/speed';
import { preferredSpeed, setPreferredSpeed } from '../../signal/speed';
import { SpeedSelector } from './SpeedSelector';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  setPreferredSpeed('standard');
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
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
  HTMLElement.prototype.scrollTo = originalScrollTo;
  vi.unstubAllGlobals();
});

const TIERS = [
  { value: 'standard' },
  { value: 'priority' },
  { value: 'ultrafast' },
];

it.each([false, true])(
  'shows the current tier and picks another (touch=%s)',
  async (touch) => {
    vi.mocked(isTouchDevice).mockReturnValue(touch);
    render(() => (
      <SpeedSelector
        offered={TIERS}
        value={preferredSpeed()}
        onChange={setPreferredSpeed}
      />
    ));
    const trigger = screen.getByRole('button', {
      name: 'Priority tier: Standard',
    });
    if (touch) fireEvent.click(trigger);
    else fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const priority = await screen.findByRole(touch ? 'button' : 'menuitem', {
      name: /Priority.*2× usage/,
    });
    if (touch) fireEvent.click(priority);
    else {
      priority.focus();
      fireEvent.keyDown(priority, { key: 'Enter' });
    }
    expect(preferredSpeed()).toBe('priority');
    expect(localStorage.getItem('macro:ai-speed')).toBe('priority');
    expect(
      screen.getByRole('button', { name: 'Priority tier: Priority' })
    ).toBeTruthy();
  }
);

it('renders nothing for a model with only standard', () => {
  render(() => (
    <SpeedSelector
      offered={[{ value: 'standard' }]}
      value="standard"
      onChange={setPreferredSpeed}
    />
  ));
  expect(screen.queryByRole('button')).toBeNull();
});

it('falls back to standard where the preferred tier is not offered', () => {
  setPreferredSpeed('priority');
  expect(speedForModel(Model.gpt61Sol, preferredSpeed())).toBe('priority');
  expect(speedForModel(Model.opus55, preferredSpeed())).toBe('standard');
  expect(nativeSpeeds(['standard', 'priority'])).toEqual([
    'standard',
    'priority',
  ]);
  expect(nativeSpeeds(['default', 'turbo'])).toBeUndefined();
});
