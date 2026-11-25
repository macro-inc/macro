import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSoundPlayer } from './sound-player';

const oscillators: { onended: (() => void) | null }[] = [];
const contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'suspended';
  destination = {};
  currentTime = 0;

  constructor() {
    contexts.push(this);
  }

  async resume() {
    this.state = 'running';
  }

  async suspend() {
    this.state = 'suspended';
  }

  createGain() {
    const param = {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    return { gain: param, connect: vi.fn(), disconnect: vi.fn() };
  }

  createOscillator() {
    const oscillator = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    oscillators.push(oscillator);
    return oscillator;
  }

  createMediaStreamDestination() {
    return { stream: {} };
  }

  async close() {
    this.state = 'closed';
  }
}

const play = vi.fn(async function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { value: false, configurable: true });
});
const pause = vi.fn(function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { value: true, configurable: true });
});
const setSinkId = vi.fn(async function (
  this: HTMLMediaElement,
  deviceId: string
) {
  Object.defineProperty(this, 'sinkId', {
    value: deviceId,
    configurable: true,
  });
});

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
    value: setSinkId,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  play.mockClear();
  pause.mockClear();
  setSinkId.mockClear();
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
  oscillators.length = 0;
  contexts.length = 0;
});

/** Ends every tone scheduled so far, as the audio clock reaching its stop. */
function endTones() {
  for (const oscillator of oscillators.splice(0)) oscillator.onended?.();
}

it('creates no audio context until something unlocks or plays', () => {
  const player = createSoundPlayer();
  player.setKeepRunning(true);
  player.setKeepRunning(false);
  expect(contexts).toHaveLength(0);
});

it('suspends once the last tone ends unless kept running', async () => {
  const player = createSoundPlayer();

  await player.play('chime', 1);
  const [context] = contexts;
  expect(context?.state).toBe('running');
  expect(oscillators.length).toBeGreaterThan(0);

  endTones();
  await Promise.resolve();
  expect(context?.state).toBe('suspended');
});

it('stays ready between cues while kept running, then suspends when released', async () => {
  const player = createSoundPlayer();
  player.setKeepRunning(true);

  await player.unlock();
  await player.play('chime', 1);
  endTones();
  await Promise.resolve();
  const [context] = contexts;
  expect(context?.state).toBe('running');

  player.setKeepRunning(false);
  await Promise.resolve();
  expect(context?.state).toBe('suspended');
});

it('lets a sounding cue finish before suspending', async () => {
  const player = createSoundPlayer();
  player.setKeepRunning(true);
  await player.play('chime', 1);
  const [context] = contexts;

  player.setKeepRunning(false);
  await Promise.resolve();
  expect(context?.state).toBe('running');

  endTones();
  await Promise.resolve();
  expect(context?.state).toBe('suspended');
});

it('resumes for the next cue after suspending', async () => {
  const player = createSoundPlayer();
  await player.play('chime', 1);
  endTones();
  await Promise.resolve();
  const [context] = contexts;
  expect(context?.state).toBe('suspended');

  await player.play('chime', 1);
  expect(context?.state).toBe('running');
  expect(contexts).toHaveLength(1);
});

it('plays no media element while no speaker is chosen', async () => {
  // A playing media element takes the iOS audio session and pauses other
  // apps' music, so an ordinary tap must not start one.
  const player = createSoundPlayer(() => null);

  await player.unlock();

  expect(play).not.toHaveBeenCalled();
});

it('routes to the chosen speaker and stops once the call clears it', async () => {
  let speaker: string | null = 'speaker-1';
  const player = createSoundPlayer(() => speaker);

  await player.unlock();

  expect(play).toHaveBeenCalledTimes(1);
  expect(setSinkId).toHaveBeenCalledWith('speaker-1');

  speaker = null;
  await player.syncOutput();

  expect(pause).toHaveBeenCalledTimes(1);
});

it('starts the speaker a call chooses after audio was unlocked', async () => {
  let speaker: string | null = null;
  const player = createSoundPlayer(() => speaker);
  await player.unlock();

  speaker = 'speaker-1';
  await player.syncOutput();

  expect(play).toHaveBeenCalledTimes(1);
  expect(setSinkId).toHaveBeenCalledWith('speaker-1');
});
