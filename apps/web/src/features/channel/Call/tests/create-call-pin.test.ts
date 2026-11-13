import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createCallPin } from '../primitives/create-call-pin';

it('retires departed participants instead of pinning their return', () => {
  createRoot((dispose) => {
    const watched = { identity: 'watched' };
    const [participants, setParticipants] = createSignal([watched]);
    const pin = createCallPin({
      callId: () => 'call-1',
      participants,
      screens: () => [],
      screenSharing: () => false,
    });
    pin.togglePin(watched);
    expect(pin.activePin()).toBe(watched);
    setParticipants([]);
    expect(pin.activePin()).toBeUndefined();
    setParticipants([watched]);
    expect(pin.activePin()).toBeUndefined();
    pin.togglePin(watched);
    expect(pin.activePin()).toBe(watched);
    pin.togglePin(watched);
    expect(pin.activePin()).toBeUndefined();
    dispose();
  });
});

it('retires a screen pin when its publication ends, even if the owner stays', () => {
  createRoot((dispose) => {
    const presenter = { identity: 'presenter' };
    const [screens, setScreens] = createSignal([presenter]);
    const pin = createCallPin({
      callId: () => 'call-1',
      participants: () => [presenter],
      screens,
      screenSharing: () => false,
    });
    pin.togglePin({ share: presenter });
    expect(pin.activePin()).toEqual({ share: presenter });
    setScreens([]);
    expect(pin.activePin()).toBeUndefined();
    setScreens([presenter]);
    expect(pin.activePin()).toBeUndefined();
    dispose();
  });
});

it('does not carry a pin into another call or revive it on rejoin', () => {
  createRoot((dispose) => {
    const watched = { identity: 'watched' };
    const [callId, setCallId] = createSignal<string | null>('call-1');
    const pin = createCallPin({
      callId,
      participants: () => [watched],
      screens: () => [],
      screenSharing: () => true,
    });
    pin.togglePin('local-share');
    expect(pin.activePin()).toBe('local-share');
    setCallId('call-2');
    expect(pin.activePin()).toBeUndefined();
    setCallId('call-1');
    expect(pin.activePin()).toBeUndefined();
    pin.togglePin(watched);
    setCallId(null);
    expect(pin.activePin()).toBeUndefined();
    dispose();
  });
});

it('clears local screen and participant pins when their sources disappear', () => {
  createRoot((dispose) => {
    const [screenSharing, setScreenSharing] = createSignal(true);
    const [participants, setParticipants] = createSignal([{}]);
    const pin = createCallPin({
      callId: () => 'call-1',
      participants,
      screens: () => [],
      screenSharing,
    });
    pin.togglePin('local-share');
    expect(pin.activePin()).toBe('local-share');
    setScreenSharing(false);
    expect(pin.activePin()).toBeUndefined();
    pin.togglePin('local');
    expect(pin.activePin()).toBe('local');
    setParticipants([]);
    expect(pin.activePin()).toBeUndefined();
    dispose();
  });
});
