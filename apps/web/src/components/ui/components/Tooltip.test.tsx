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

it('keeps owned tooltip portals inside the fullscreen element', async () => {
  device.isTouch = () => false;
  let root!: HTMLDivElement;
  let fullscreen: Element | null = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });
  try {
    render(() => (
      <div ref={root}>
        <Tooltip.Root open>
          <Tooltip.Trigger>Trigger</Tooltip.Trigger>
          <Tooltip.Portal>
            <span data-testid="fullscreen-tip">Tooltip</span>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    ));
    expect(root.contains(screen.getByTestId('fullscreen-tip'))).toBe(false);
    fullscreen = root;
    document.dispatchEvent(new Event('fullscreenchange'));
    await waitFor(() =>
      expect(root.contains(screen.getByTestId('fullscreen-tip'))).toBe(true)
    );
    fullscreen = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    await waitFor(() =>
      expect(root.contains(screen.getByTestId('fullscreen-tip'))).toBe(false)
    );
  } finally {
    Reflect.deleteProperty(document, 'fullscreenElement');
  }
});

it('measures the target on every attempt to open without changing default tooltips', () => {
  device.isTouch = () => false;
  let width = 40;
  let target!: HTMLSpanElement;
  render(() => (
    <>
      <Tooltip.Root measureTarget={() => target}>
        <Tooltip.Trigger>Measured</Tooltip.Trigger>
        <span ref={target}>Title</span>
        <Tooltip.Portal>
          <Tooltip.Content>Full title</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger>Default</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>Default hint</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </>
  ));
  vi.spyOn(target, 'clientWidth', 'get').mockReturnValue(60);
  vi.spyOn(target, 'scrollWidth', 'get').mockImplementation(() => width);
  const measured = screen.getByRole('button', { name: 'Measured' });
  measured.focus();
  expect(screen.queryByText('Full title')).toBeNull();
  measured.blur();
  screen.getByRole('button', { name: 'Default' }).focus();
  expect(screen.getByRole('tooltip').textContent).toContain('Default hint');
  measured.focus();
  width = 100;
  measured.blur();
  measured.focus();
  expect(screen.getByRole('tooltip').textContent).toContain('Full title');
  measured.blur();
  width = 40;
  measured.focus();
  expect(screen.queryByText('Full title')).toBeNull();
});

it.each([
  { controlled: true, width: 40, visible: false },
  { controlled: false, width: 40, visible: false },
  { controlled: true, width: 100, visible: true },
  { controlled: false, width: 100, visible: true },
])(
  'gates initially open measured tooltips: %j',
  ({ controlled, width, visible }) => {
    device.isTouch = () => false;
    const target = document.createElement('span');
    target.textContent = 'Measured title';
    vi.spyOn(target, 'clientWidth', 'get').mockReturnValue(60);
    vi.spyOn(target, 'scrollWidth', 'get').mockReturnValue(width);
    render(() => (
      <Tooltip.Root
        measureTarget={() => target}
        open={controlled ? true : undefined}
        defaultOpen={!controlled}
      >
        <Tooltip.Trigger>Initially open</Tooltip.Trigger>
        {target}
        <Tooltip.Portal>
          <Tooltip.Content>Full measured title</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));
    expect(Boolean(screen.queryByRole('tooltip'))).toBe(visible);
  }
);
