import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope, setPressedKeys } from '@core/hotkey/state';
import { getHotkeyCommand, getKeyString } from '@core/hotkey/utils';
import { fireEvent, waitFor } from '@solidjs/testing-library';
import type { Room } from 'livekit-client';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCallHotkeys } from '../call-hotkeys';

vi.mock('@core/constant/isMac', () => ({ IS_MAC: true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  setPressedKeys(new Set<string>());
  setActiveScope('global');
});

function setup(gate?: Promise<void>) {
  const [muted, setMuted] = createSignal(true);
  const [active, setActive] = createSignal(true);
  const [id, setId] = createSignal('call-one');
  const room = {} as Room;
  const toggleAudio = vi.fn(async () => {
    const next = !muted();
    if (!next && gate) await gate;
    setMuted(next);
  });
  const toggleVideo = vi.fn(async () => {});
  const fullscreen = vi.fn(async () => {});
  createRoot((dispose) => {
    disposers.push(dispose);
    useHotKeyRoot();
    createCallHotkeys(
      {
        isInCall: active,
        isConnecting: () => false,
        activeCallId: id,
        room: () => room,
        isAudioMuted: muted,
        toggleAudio,
        toggleVideo,
      },
      { available: () => true, toggle: fullscreen }
    );
  });
  return { muted, setActive, setId, toggleAudio, toggleVideo, fullscreen };
}
function key(
  key: string,
  modifiers: KeyboardEventInit = {},
  target: HTMLElement = document.body
) {
  fireEvent.keyDown(target, { key, ...modifiers });
  fireEvent.keyUp(target, { key, ...modifiers });
  if (modifiers.metaKey) fireEvent.keyUp(target, { key: 'Meta' });
}

it('registers call-only hidden commands and routes the exact Mac chords', async () => {
  const call = setup();
  key('d', { metaKey: true });
  key('E', { metaKey: true, shiftKey: true });
  key('f', { metaKey: true, ctrlKey: true });
  expect(call.toggleAudio).toHaveBeenCalledOnce();
  expect(call.toggleVideo).toHaveBeenCalledOnce();
  expect(call.fullscreen).toHaveBeenCalledOnce();
  expect(getHotkeyCommand('global', 'cmd+d')?.hide).toBe(true);
  expect(getKeyString(new Set(['cmd', 'f', 'ctrl']))).toBe('ctrl+cmd+f');
  call.setActive(false);
  key('d', { metaKey: true });
  expect(call.toggleAudio).toHaveBeenCalledOnce();
});

it('restores mute when releasing Space as the final pressed key', async () => {
  const call = setup();
  fireEvent.keyDown(document.body, { key: ' ' });
  await waitFor(() => expect(call.muted()).toBe(false));
  fireEvent.keyUp(document.body, { key: ' ' });
  await waitFor(() => expect(call.muted()).toBe(true));
  expect(call.toggleAudio).toHaveBeenCalledTimes(2);
});

it('does not take Space from buttons or text fields', () => {
  const call = setup();
  for (const tag of ['button', 'input', 'textarea']) {
    const target = document.createElement(tag);
    document.body.append(target);
    target.focus();
    key(' ', {}, target);
  }
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  document.body.append(editable);
  key(' ', {}, editable);
  expect(call.toggleAudio).not.toHaveBeenCalled();
});

it('restores mute after a delayed enable completes after keyup', async () => {
  let finish!: () => void;
  const call = setup(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  fireEvent.keyDown(document.body, { key: ' ' });
  fireEvent.keyUp(document.body, { key: ' ' });
  finish();
  await waitFor(() => expect(call.toggleAudio).toHaveBeenCalledTimes(2));
  expect(call.muted()).toBe(true);
});

it('does not mute a replacement call after a delayed enable', async () => {
  let finish!: () => void;
  const call = setup(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  fireEvent.keyDown(document.body, { key: ' ' });
  call.setId('call-two');
  fireEvent.keyUp(document.body, { key: ' ' });
  finish();
  await waitFor(() => expect(call.muted()).toBe(false));
  expect(call.toggleAudio).toHaveBeenCalledOnce();
});

it('restores mute on window blur and unregisters when the call view closes', async () => {
  const call = setup();
  fireEvent.keyDown(document.body, { key: ' ' });
  await waitFor(() => expect(call.muted()).toBe(false));
  window.dispatchEvent(new Event('blur'));
  await waitFor(() => expect(call.muted()).toBe(true));
  for (const dispose of disposers.splice(0)) dispose();
  key('d', { metaKey: true });
  expect(call.toggleAudio).toHaveBeenCalledTimes(2);
  expect(getHotkeyCommand('global', 'cmd+d')).toBeUndefined();
});
