import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setZoom: vi.fn(async (_factor: number) => {}),
  isDesktopPlatform: vi.fn(() => true),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));
vi.mock('@core/util/platform', () => ({
  isDesktopPlatform: mocks.isDesktopPlatform,
}));

const disposers: (() => void)[] = [];

function shutDown() {
  for (const dispose of disposers.splice(0)) dispose();
}

/**
 * Starts the app with a fresh module graph, so each launch restores the saved
 * zoom the way a relaunch does. The hotkey root has to come from the same
 * graph as the zoom module, or they hold separate scope trees.
 */
async function launch() {
  vi.resetModules();
  const [{ useHotKeyRoot }, { useDesktopZoom }] = await Promise.all([
    import('@core/hotkey/hotkeys'),
    import('./zoom'),
  ]);
  createRoot((dispose) => {
    disposers.push(dispose);
    useHotKeyRoot();
    useDesktopZoom();
  });
}

/** jsdom is not a Mac, so the hotkey system reads cmd off the control key. */
function press(key: string, modifiers: { shiftKey?: boolean } = {}) {
  const init = { key, ctrlKey: true, ...modifiers };
  document.dispatchEvent(new KeyboardEvent('keydown', init));
  document.dispatchEvent(new KeyboardEvent('keyup', init));
}

beforeEach(() => {
  localStorage.clear();
  mocks.setZoom.mockClear();
  mocks.isDesktopPlatform.mockReturnValue(true);
});

afterEach(shutDown);

describe('desktop zoom hotkeys', () => {
  it('zooms out a step', async () => {
    await launch();

    press('-');

    expect(mocks.setZoom).toHaveBeenCalledExactlyOnceWith(0.9);
  });

  it('zooms in a step', async () => {
    await launch();

    press('=');

    expect(mocks.setZoom).toHaveBeenCalledExactlyOnceWith(1.1);
  });

  it('zooms in on the shifted plus a keyboard actually sends', async () => {
    await launch();

    press('+', { shiftKey: true });

    expect(mocks.setZoom).toHaveBeenCalledExactlyOnceWith(1.1);
  });

  it('returns to actual size', async () => {
    await launch();

    press('=');
    press('=');
    press('0');

    expect(mocks.setZoom).toHaveBeenLastCalledWith(1);
  });

  it('stops at the smallest step', async () => {
    await launch();

    for (let i = 0; i < 8; i++) press('-');

    expect(mocks.setZoom).toHaveBeenLastCalledWith(0.5);
    expect(mocks.setZoom).toHaveBeenCalledTimes(4);
  });

  it('re-applies the saved zoom on the next launch', async () => {
    await launch();
    press('-');
    shutDown();
    mocks.setZoom.mockClear();

    await launch();

    expect(mocks.setZoom).toHaveBeenCalledExactlyOnceWith(0.9);
  });

  it('leaves the keys to the browser on the web', async () => {
    mocks.isDesktopPlatform.mockReturnValue(false);

    await launch();
    press('-');

    expect(mocks.setZoom).not.toHaveBeenCalled();
  });
});
