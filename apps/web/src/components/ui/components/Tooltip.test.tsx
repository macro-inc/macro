import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTooltipsEnabled } from '../signals/signals';
import { Tooltip } from './Tooltip';

const device = vi.hoisted(() => ({ isTouch: (): boolean => true }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.isTouch(),
}));

beforeEach(() => {
  vi.stubEnv('MODE', 'development');
  device.isTouch = () => true;
  setTooltipsEnabled(true);
  const rects = [new DOMRect(0, 0, 40, 40)];
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(
    Object.assign(rects, { item: (index: number) => rects[index] ?? null })
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Tooltip touch behavior', () => {
  it('keeps the focused back action available without showing its tooltip on touch', () => {
    const back = vi.fn();
    render(() => (
      <Tooltip label="Back to thread" tabIndex={0}>
        <button onClick={back}>Back</button>
      </Tooltip>
    ));
    const button = screen.getByRole('button', { name: 'Back' });
    button.parentElement?.focus();
    expect(document.activeElement).toBe(button.parentElement);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(button);
    expect(back).toHaveBeenCalledOnce();
  });

  it('suppresses explicitly opened tooltips on touch', () => {
    render(() => (
      <Tooltip label="Back to thread" open>
        <button>Back</button>
      </Tooltip>
    ));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes when touch detection changes without replacing the focused control', () => {
    const [touch, setTouch] = createSignal(false);
    device.isTouch = touch;
    render(() => (
      <Tooltip label="Back to thread" open>
        <button>Back</button>
      </Tooltip>
    ));
    const button = screen.getByRole('button', { name: 'Back' });
    button.focus();
    expect(screen.getByRole('tooltip').textContent).toContain('Back to thread');
    setTouch(true);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBe(button);
    expect(document.activeElement).toBe(button);
  });

  it('still opens on keyboard focus on desktop', () => {
    device.isTouch = () => false;
    render(() => (
      <Tooltip label="Back to thread" tabIndex={0}>
        <button>Back</button>
      </Tooltip>
    ));
    const button = screen.getByRole('button', { name: 'Back' });
    button.parentElement?.focus();
    expect(screen.getByRole('tooltip').textContent).toContain('Back to thread');
  });
});
