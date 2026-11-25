import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSoundPlayer } from './sound-player';

class FakeAudioContext {
  state = 'suspended';
  destination = {};

  async resume() {
    this.state = 'running';
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
