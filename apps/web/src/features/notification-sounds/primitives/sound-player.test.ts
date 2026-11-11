import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSoundPlayer } from './sound-player';

const PLAYERS: ReturnType<typeof createSoundPlayer>[] = [];

class TestAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createMediaStreamDestination = vi.fn(() => ({ stream: {} }));
  createGain = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  }));
  createOscillator = vi.fn(() => ({
    type: 'sine',
    frequency: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: undefined,
  }));
}

class TestAudio {
  paused = true;
  sinkId = '';
  srcObject: unknown;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  setSinkId = vi.fn(async (id: string) => {
    this.sinkId = id;
  });
}

let context: TestAudioContext;
let output: TestAudio;

beforeEach(() => {
  vi.useFakeTimers();
  context = new TestAudioContext();
  output = new TestAudio();
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return context;
    })
  );
  vi.stubGlobal(
    'Audio',
    vi.fn(function () {
      return output;
    })
  );
  vi.stubGlobal('HTMLMediaElement', { prototype: { setSinkId() {} } });
});
afterEach(async () => {
  await Promise.all(PLAYERS.splice(0).map((player) => player.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('routes call cues through the selected speaker without rerouting notifications', async () => {
  const calls = createSoundPlayer(() => 'headset');
  PLAYERS.push(calls);
  await calls.play('call-join', 0.7);
  expect(output.sinkId).toBe('headset');
  expect(output.play).toHaveBeenCalledOnce();
  expect(context.createGain.mock.results[0].value.connect).toHaveBeenCalledWith(
    context.createMediaStreamDestination.mock.results[0].value
  );

  const notifications = createSoundPlayer();
  PLAYERS.push(notifications);
  await notifications.play('chime', 0.7);
  expect(
    context.createGain.mock.results.at(-1)?.value.connect
  ).toHaveBeenCalledWith(context.destination);
  expect(output.setSinkId).toHaveBeenCalledTimes(1);
});

it('uses the browser default on platforms without speaker selection', async () => {
  vi.stubGlobal('HTMLMediaElement', { prototype: {} });
  const player = createSoundPlayer(() => 'headset');
  PLAYERS.push(player);
  await player.play('call-join', 0.7);
  expect(context.createMediaStreamDestination).not.toHaveBeenCalled();
  expect(context.createGain.mock.results[0].value.connect).toHaveBeenCalledWith(
    context.destination
  );
});

it('does not send a call cue to the default speaker when selection fails', async () => {
  output.setSinkId.mockRejectedValue(
    new DOMException('Not allowed', 'NotAllowedError')
  );
  const player = createSoundPlayer(() => 'headset');
  PLAYERS.push(player);
  await expect(player.play('call-join', 0.7)).rejects.toThrow('Not allowed');
  expect(context.createOscillator).not.toHaveBeenCalled();
});

it('finishes an in-flight speaker switch on the newest selection', async () => {
  let speaker = 'headset';
  const player = createSoundPlayer(() => speaker);
  PLAYERS.push(player);
  const firstSwitch = Promise.withResolvers<void>();
  output.setSinkId.mockImplementationOnce(async (id) => {
    await firstSwitch.promise;
    output.sinkId = id;
  });
  const playing = player.play('call-join', 0.7);
  speaker = 'speakers';
  firstSwitch.resolve();
  await playing;
  expect(output.sinkId).toBe('speakers');
  expect(context.createOscillator).toHaveBeenCalledTimes(2);
});

it('recovers interrupted audio before playing a fresh cue', async () => {
  context.state = 'interrupted';
  const player = createSoundPlayer();
  PLAYERS.push(player);
  await player.play('call-leave', 0.7);
  expect(context.resume).toHaveBeenCalledOnce();
  expect(context.createOscillator).toHaveBeenCalledTimes(2);
});

it('drops a suspended cue instead of replaying it after a later gesture', async () => {
  const resume = Promise.withResolvers<void>();
  context.resume.mockImplementation(async () => {
    await resume.promise;
    context.state = 'running';
  });
  const player = createSoundPlayer();
  PLAYERS.push(player);
  const playing = player.play('call-join', 0.7);
  await vi.advanceTimersByTimeAsync(300);
  await playing;
  expect(context.createOscillator).not.toHaveBeenCalled();
  resume.resolve();
  await player.unlock();
  expect(context.createOscillator).not.toHaveBeenCalled();
  await player.play('call-leave', 0.7);
  expect(context.createOscillator).toHaveBeenCalledTimes(2);
});

it('drops a cue while its speaker switch is blocked', async () => {
  const switched = Promise.withResolvers<void>();
  output.setSinkId.mockImplementation(async (id) => {
    await switched.promise;
    output.sinkId = id;
  });
  const player = createSoundPlayer(() => 'headset');
  PLAYERS.push(player);
  const playing = player.play('call-join', 0.7);
  await vi.advanceTimersByTimeAsync(300);
  await playing;
  switched.resolve();
  await player.syncOutput();
  expect(context.createOscillator).not.toHaveBeenCalled();
});

it('does not play a pending cue after its owner is disposed', async () => {
  const resume = Promise.withResolvers<void>();
  context.resume.mockImplementation(() => resume.promise);
  const player = createSoundPlayer(() => 'headset');
  PLAYERS.push(player);
  const playing = player.play('call-join', 0.7);
  await player.dispose();
  resume.resolve();
  await playing;
  expect(context.createOscillator).not.toHaveBeenCalled();
  expect(output.srcObject).toBeNull();
  expect(context.close).toHaveBeenCalledOnce();
});
