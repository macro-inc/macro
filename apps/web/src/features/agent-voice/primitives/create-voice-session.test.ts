import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceCredentials,
  VoiceDependencies,
  VoiceMediaEvents,
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
  const media = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    mute: vi.fn(async () => {}),
    enablePlayback: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
  };
  const bridge = {
    request: vi.fn(),
    cancel: vi.fn(),
    context: vi.fn(),
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
    callActive: () => false,
    media: vi.fn(async (_credentials, callbacks) => {
      events = callbacks;
      return media;
    }),
    bridge: vi.fn(async () => bridge),
    uuid: () => 'client-id',
    ...overrides,
  };
  const controller = createRoot((dispose) => {
    cleanups.push(dispose);
    return createVoiceSession(deps);
  });
  cleanups.push(controller.dispose);
  return { controller, deps, media, bridge, release, events: () => events };
}
describe('agent voice lifetime', () => {
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
  it('ends a late-created backend room after the user cancels connecting', async () => {
    const pending = deferred<VoiceCredentials>();
    const { controller, deps, release } = setup({
      start: () => pending.promise,
    });
    await controller.open({ sessionId: 'a', title: 'A' });
    const starting = controller.start();
    await Promise.resolve();
    await controller.end();
    pending.resolve(credentials);
    await starting;
    expect(deps.media).not.toHaveBeenCalled();
    expect(deps.end).toHaveBeenCalledWith('a', 'voice');
    expect(release).toHaveBeenCalled();
    expect(controller.state().phase).toBe('ready');
  });
  it('ignores stale media callbacks after ending and releases every resource', async () => {
    const { controller, media, bridge, release, events } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    const old = events();
    await controller.end();
    old.connection('connected');
    old.caption({ id: 'late', speaker: 'agent', text: 'old', final: true });
    expect(controller.state().phase).toBe('ready');
    expect(controller.state().captions).toEqual([]);
    expect(media.disconnect).toHaveBeenCalledOnce();
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it('cleans up and exposes a recoverable microphone permission error', async () => {
    const { controller, media, release, deps } = setup();
    media.connect.mockRejectedValueOnce(
      new Error('Microphone permission denied')
    );
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    expect(controller.state().phase).toBe('error');
    expect(controller.state().error).toContain('permission denied');
    expect(release).toHaveBeenCalled();
    expect(deps.end).toHaveBeenCalled();
    await controller.start();
    expect(controller.state().phase).toBe('connected');
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
  it('uses a hard duration limit without stopping underlying agent work', async () => {
    vi.useFakeTimers();
    const { controller, bridge } = setup();
    await controller.open({ sessionId: 'a', title: 'A' });
    await controller.start();
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(controller.state().phase).toBe('error');
    expect(controller.state().error).toContain('time limit');
    expect(bridge.cancel).not.toHaveBeenCalled();
  });
  it('disposes a media adapter that arrives after End', async () => {
    const pending = deferred<Awaited<ReturnType<VoiceDependencies['media']>>>();
    let creatingMedia = false;
    const { controller, media, bridge, release } = setup({
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
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
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
