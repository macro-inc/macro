/** @vitest-environment jsdom */

import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SelectSessionConfigOption } from '../state/session-config';
import { EffortSelector } from './EffortSelector';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

const config: SelectSessionConfigOption = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  description: null,
  type: 'select',
  currentValue: 'low',
  options: [
    { name: 'Low', value: 'low', group: null, description: null },
    { name: 'High', value: 'high', group: null, description: null },
  ],
};
const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
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
it.each([false, true])(
  'selects a named effort option and closes (touch=%s)',
  async (touch) => {
    vi.mocked(isTouchDevice).mockReturnValue(touch);
    const change = vi.fn();
    const openChange = vi.fn();
    render(() => (
      <EffortSelector
        config={config}
        onChange={change}
        onOpenChange={openChange}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Effort: Low' });
    if (touch) fireEvent.click(trigger);
    else fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const high = await screen.findByRole(touch ? 'button' : 'menuitem', {
      name: 'High',
    });
    if (touch) {
      expect(
        screen.getByRole('button', { name: 'Low' }).getAttribute('aria-pressed')
      ).toBe('true');
      expect(high.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(high);
    } else {
      high.focus();
      fireEvent.keyDown(high, { key: 'Enter' });
    }
    expect(openChange).toHaveBeenLastCalledWith(false);
    expect(change).toHaveBeenCalledExactlyOnceWith({
      configId: 'effort',
      value: 'high',
      name: 'High',
    });
  }
);
it('hides unsupported effort', () => {
  render(() => <EffortSelector onChange={vi.fn()} />);
  expect(screen.queryByRole('button')).toBeNull();
});
it('does not open while configuration is disabled', () => {
  render(() => <EffortSelector config={config} disabled onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Effort: Low' }));
  expect(screen.queryByRole('group', { name: 'Reasoning effort' })).toBeNull();
});

it('returns focus to the composer when the mobile chooser closes', async () => {
  vi.mocked(isTouchDevice).mockReturnValue(true);
  let input!: HTMLTextAreaElement;
  render(() => (
    <>
      <style>{`[data-corvu-drawer-content] { transition-duration: 0s; }`}</style>
      <textarea ref={input} aria-label="Message" />
      <EffortSelector
        config={config}
        onChange={vi.fn()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          input.focus();
        }}
      />
    </>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Effort: Low' }));
  const low = await screen.findByRole('button', { name: 'Low' });
  await waitFor(() => expect(document.activeElement).toBe(low));
  fireEvent.keyDown(low, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(input));
});
