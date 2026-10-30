import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
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

  it('uses the control itself as a compound tooltip trigger', () => {
    device.isTouch = () => false;
    render(() => (
      <Tooltip.Root open>
        <Tooltip.Trigger>Details</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>Show details</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));
    const button = screen.getByRole('button', { name: 'Details' });
    expect(button.tagName).toBe('BUTTON');
    expect(screen.getByRole('tooltip').textContent).toContain('Show details');
  });

  it('closes when a compound trigger unmounts', () => {
    device.isTouch = () => false;
    const [mounted, setMounted] = createSignal(true);
    render(() => (
      <Tooltip.Root defaultOpen>
        <Show when={mounted()}>
          <Tooltip.Trigger>Details</Tooltip.Trigger>
        </Show>
        <Tooltip.Portal>
          <Tooltip.Content>Show details</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));
    expect(screen.getByRole('tooltip').textContent).toContain('Show details');
    setMounted(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps the pointer-transparent override without losing caller styles', () => {
    device.isTouch = () => false;
    render(() => (
      <Tooltip.Root open>
        <Tooltip.Trigger>Details</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content style={{ color: 'red', 'pointer-events': 'auto' }}>
            Show details
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.classList.contains('pointer-events-none!')).toBe(true);
    expect(tooltip.style.color).toBe('red');
  });

  it('hides the popup when a mounted trigger loses its layout box', async () => {
    device.isTouch = () => false;
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
      1024
    );
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(
      768
    );
    const [hidden, setHidden] = createSignal(false);
    render(() => (
      <Tooltip.Root
        open
        getAnchorRect={
          hidden()
            ? () => ({ x: 0, y: 0, width: 0, height: 0 })
            : () => ({ x: 64, y: 64, width: 40, height: 40 })
        }
      >
        <Tooltip.Trigger style={{ display: hidden() ? 'none' : undefined }}>
          Details
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>Show details</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));
    const trigger = screen.getByRole('button', { name: 'Details' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
    setHidden(true);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(trigger.isConnected).toBe(true);
  });
});
