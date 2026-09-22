import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceCredentials,
  VoiceDependencies,
  VoiceMediaEvents,
  VoiceMicrophone,
} from '../core/types';
import { VoiceStartError } from '../core/types';
import { createVoiceSession } from './create-voice-session';

const credentials: VoiceCredentials = {
  voiceSessionId: 'voice',
  roomName: 'room',
  url: 'wss://voice.example',
  token: 'test-only',
  participantIdentity: 'user',
  agentIdentity: 'agent',
  expiresAt: '2026-09-23T00:00:00Z',
  voice: 'marin',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});
function setup(overrides: Partial<VoiceDependencies> = {}) {
  let events!: VoiceMediaEvents;
  const release = vi.fn();
  const microphone: VoiceMicrophone = {
    track: {} as MediaStreamTrack,
    stop: vi.fn(),
  };
  const media = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    mute: vi.fn(async () => {}),
    enablePlayback: vi.fn(async () => {}),
  };
  const observer = {
    close: vi.fn(),
  };
  const deps: VoiceDependencies = {
    options: vi.fn(async () => ({
      enabled: true,
      voices: [
        { id: 'marin', label: 'Marin' },
        { id: 'cedar', label: 'Cedar' },
      ],
      maxDurationSeconds: 1800,
    })),
    start: vi.fn(async () => credentials),
    end: vi.fn(async () => {}),
    acquireMicrophone: vi.fn(async () => release),
    requestMicrophone: vi.fn(async () => microphone),
    callActive: () => false,
    media: vi.fn(async (_credentials, callbacks) => {
      events = callbacks;
      return media;
    }),
    observeSession: vi.fn(async () => observer),
    uuid: () => 'client-id',
    ...overrides,
  };
  const controller = createRoot((dispose) => {
    cleanups.push(dispose);
    return createVoiceSession(deps);
  });
  cleanups.push(controller.dispose);
  return {
    controller,
    deps,
    media,
    microphone,
    observer,
    release,
    events: () => events,
  };
}
describe('agent voice lifetime', () => {
  it('waits for microphone permission before provisioning or connecting media', async () => {
    const pending = deferred<VoiceMicrophone>();
    const { controller, deps, microphone } = setup({
      requestMicrophone: vi.fn(() => pending.promise),
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    expect(deps.requestMicrophone).not.toHaveBeenCalled();
    const starting = controller.start();
    await vi.waitFor(() =>
      expect(deps.requestMicrophone).toHaveBeenCalledOnce()
    );
    expect(controller.state().phase).toBe('requesting-microphone');
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.media).not.toHaveBeenCalled();
    pending.resolve(microphone);
    await starting;
    expect(deps.media).toHaveBeenCalledWith(
      credentials,
      expect.any(Object),
      microphone
    );
  });
  it('stops a late microphone grant after the user ends the permission step', async () => {
    const pending = deferred<VoiceMicrophone>();
    const { controller, deps, microphone, release } = setup({
      requestMicrophone: vi.fn(() => pending.promise),
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    const starting = controller.start();
    await vi.waitFor(() =>
      expect(deps.requestMicrophone).toHaveBeenCalledOnce()
    );
    await controller.end();
    pending.resolve(microphone);
    await starting;
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(deps.start).not.toHaveBeenCalled();
    expect(controller.state().phase).toBe('ready');
  });
  it('does not request microphone access when voice is disabled by the server', async () => {
    const { controller, deps } = setup({
      options: async () => ({
        enabled: false,
        voices: [],
        maxDurationSeconds: 1800,
      }),
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    expect(deps.requestMicrophone).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  });
  it('retries unavailable options without turning on the microphone', async () => {
    const options = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network lost'))
      .mockResolvedValue({
        enabled: true,
        voices: [{ id: 'marin', label: 'Marin' }],
        maxDurationSeconds: 1800,
      });
    const { controller, deps } = setup({ options });
    await controller.open({ sessionId: 'a', title: 'A' });
    expect(controller.state().phase).toBe('error');
    await controller.start();
    expect(controller.state().phase).toBe('ready');
    expect(deps.acquireMicrophone).not.toHaveBeenCalled();
  });
  it('keeps one session while the panel is minimized or another session is opened', async () => {
    const { controller, deps } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    controller.hide();
    await controller.open({ sessionId: 'b', title: 'B' });
    expect(controller.state().target?.sessionId).toBe('a');
    expect(controller.visible()).toBe(true);
    expect(deps.start).toHaveBeenCalledOnce();
  });
  it('blocks voice before taking microphone ownership when a call is active', async () => {
    const { controller, deps } = setup({ callActive: () => true });
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    expect(deps.acquireMicrophone).not.toHaveBeenCalled();
    expect(controller.state().error).toContain('Leave your call');
  });
  it('keeps media and microphone ownership through reconnect and minimize', async () => {
    const { controller, deps, media, microphone, release, events } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    events().connection('reconnecting');
    controller.hide();
    await controller.open({ sessionId: 'b', title: 'B' });
    expect(controller.state().phase).toBe('reconnecting');
    expect(controller.state().target?.sessionId).toBe('a');
    expect(media.disconnect).not.toHaveBeenCalled();
    expect(microphone.stop).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(deps.end).not.toHaveBeenCalled();
    events().connection('connected');
    expect(controller.state().phase).toBe('connected');
    expect(deps.start).toHaveBeenCalledOnce();
  });
  it('ends a late-created backend room after the user cancels connecting', async () => {
    const pending = deferred<VoiceCredentials>();
    const { controller, deps, release } = setup({
      start: vi.fn(() => pending.promise),
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    const starting = controller.start();
    await vi.waitFor(() => expect(deps.start).toHaveBeenCalledOnce());
    await controller.end();
    pending.resolve(credentials);
    await starting;
    expect(deps.media).not.toHaveBeenCalled();
    expect(deps.end).toHaveBeenCalledWith('a', 'voice');
    expect(release).toHaveBeenCalled();
    expect(controller.state().phase).toBe('ready');
  });
  it('ignores stale media callbacks after ending and releases every resource', async () => {
    const { controller, media, microphone, observer, release, events } =
      setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    const old = events();
    await controller.end();
    old.connection('connected');
    old.caption({ id: 'late', speaker: 'agent', text: 'old', final: true });
    expect(controller.state().phase).toBe('ready');
    expect(controller.state().captions).toEqual([]);
    expect(media.disconnect).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(microphone.stop).toHaveBeenCalledOnce();
  });
  it('cleans up and exposes a recoverable microphone permission error', async () => {
    const requestMicrophone = vi
      .fn()
      .mockRejectedValueOnce(new Error('Microphone permission denied'));
    const { controller, microphone, release, deps } = setup({
      requestMicrophone,
    });
    requestMicrophone.mockResolvedValue(microphone);
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    expect(controller.state().phase).toBe('error');
    expect(controller.state().error).toContain('permission denied');
    expect(release).toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.media).not.toHaveBeenCalled();
    expect(deps.end).not.toHaveBeenCalled();
    await controller.start();
    expect(controller.state().phase).toBe('connected');
  });
  it('releases the granted microphone when backend provisioning fails', async () => {
    const { controller, microphone, release } = setup({
      start: async () => {
        throw new Error('Voice service is unavailable');
      },
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(controller.state().error).toBe('Voice service is unavailable');
  });
  it('replaces interim captions without accumulating duplicates and fences active voice selection', async () => {
    const { controller, events } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    controller.selectVoice('cedar');
    await controller.start();
    controller.selectVoice('marin');
    events().caption({
      id: 'one',
      speaker: 'user',
      text: 'Hello',
      final: false,
    });
    events().caption({
      id: 'one',
      speaker: 'user',
      text: 'Hello there',
      final: true,
    });
    expect(controller.state().voice).toBe('cedar');
    expect(controller.state().captions).toHaveLength(1);
    expect(controller.state().captions[0].text).toBe('Hello there');
  });
  it('releases the session observer at the hard duration limit', async () => {
    vi.useFakeTimers();
    const { controller, observer } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(controller.state().phase).toBe('error');
    expect(controller.state().error).toContain('time limit');
    expect(observer.close).toHaveBeenCalledOnce();
  });
  it('disposes a media adapter that arrives after End', async () => {
    const pending = deferred<Awaited<ReturnType<VoiceDependencies['media']>>>();
    let creatingMedia = false;
    const { controller, media, observer, release } = setup({
      media: () => {
        creatingMedia = true;
        return pending.promise;
      },
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    const starting = controller.start();
    await vi.waitFor(() => expect(creatingMedia).toBe(true));
    await controller.end();
    pending.resolve(media);
    await starting;
    expect(media.connect).not.toHaveBeenCalled();
    expect(media.disconnect).toHaveBeenCalledOnce();
    expect(observer.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it('closes a session observer that finishes opening after End', async () => {
    const pending =
      deferred<Awaited<ReturnType<VoiceDependencies['observeSession']>>>();
    const observeSession = vi.fn(() => pending.promise);
    const { controller, observer, deps } = setup({ observeSession });
    await controller.open({ sessionId: 'a', title: 'A' });
    const starting = controller.start();
    await vi.waitFor(() => expect(observeSession).toHaveBeenCalledOnce());
    await controller.end();
    pending.resolve(observer);
    await starting;
    expect(observer.close).toHaveBeenCalledOnce();
    expect(deps.media).not.toHaveBeenCalled();
  });
  it('reflects canonical review metadata and ignores it after End', async () => {
    const { controller, deps } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    const reviewRequired = vi.mocked(deps.observeSession).mock.calls[0][1];
    reviewRequired(true);
    expect(controller.state().reviewRequired).toBe(true);
    await controller.end();
    reviewRequired(true);
    expect(controller.state().reviewRequired).toBe(false);
  });
  it('reuses the same start identity after an ambiguous network failure', async () => {
    const uuid = vi
      .fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce('second');
    const start = vi
      .fn()
      .mockRejectedValueOnce(new VoiceStartError('Network lost', true))
      .mockResolvedValue(credentials);
    const { controller } = setup({ uuid, start });
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    controller.selectVoice('cedar');
    await controller.start();
    expect(start.mock.calls).toEqual([
      ['a', 'marin', 'first'],
      ['a', 'marin', 'first'],
    ]);
    expect(controller.state().voice).toBe('marin');
  });
  it('uses a fresh start identity after the server confirms rejection', async () => {
    const uuid = vi
      .fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce('second');
    const start = vi
      .fn()
      .mockRejectedValueOnce(
        new VoiceStartError('That voice session ended', false)
      )
      .mockResolvedValue(credentials);
    const { controller } = setup({ uuid, start });
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    await controller.start();
    expect(start.mock.calls).toEqual([
      ['a', 'marin', 'first'],
      ['a', 'marin', 'second'],
    ]);
  });
});
