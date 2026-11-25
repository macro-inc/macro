import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createSoundUnlock } from './sound-unlock';

function mount(initiallyWanted: boolean) {
  const player = {
    unlock: vi.fn().mockResolvedValue(undefined),
    setKeepRunning: vi.fn(),
  };
  const [wanted, setWanted] = createSignal(initiallyWanted);
  const dispose = createRoot((dispose) => {
    createSoundUnlock(player, wanted);
    return dispose;
  });
  return { player, setWanted, dispose };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setUserActivation(isActive: boolean | undefined) {
  Object.defineProperty(navigator, 'userActivation', {
    value: isActive === undefined ? undefined : { isActive },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(navigator, 'userActivation');
});

it('keeps audio ready only while sounds are wanted', () => {
  const { player, setWanted, dispose } = mount(false);
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(false);

  setWanted(true);
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(true);

  setWanted(false);
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(false);
  dispose();
});

it('lets audio suspend while the page is hidden', () => {
  const { player, dispose } = mount(true);
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(true);

  setVisibility('hidden');
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(false);

  setVisibility('visible');
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(true);

  window.dispatchEvent(new Event('pagehide'));
  expect(player.setKeepRunning).toHaveBeenLastCalledWith(false);
  dispose();
});

it('unlocks when sounds turn on inside a gesture, not outside one', () => {
  const { player, setWanted, dispose } = mount(false);

  setUserActivation(undefined);
  setWanted(true);
  expect(player.unlock).not.toHaveBeenCalled();

  setWanted(false);
  setUserActivation(false);
  setWanted(true);
  expect(player.unlock).not.toHaveBeenCalled();

  setWanted(false);
  setUserActivation(true);
  setWanted(true);
  expect(player.unlock).toHaveBeenCalledTimes(1);
  dispose();
});

it('never unlocks for untrusted events', () => {
  const { player, dispose } = mount(true);
  window.dispatchEvent(new Event('pointerdown'));
  window.dispatchEvent(new Event('click'));
  expect(player.unlock).not.toHaveBeenCalled();
  dispose();
});
