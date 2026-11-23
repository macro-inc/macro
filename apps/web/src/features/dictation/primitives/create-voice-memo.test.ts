import { renderHook } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { AudioRecorderCallbacks, RecorderHandle } from '../core/recording';
import { createVoiceMemo } from './create-voice-memo';

/** A recorder whose events the test fires explicitly. */
class FakeRecorder implements RecorderHandle {
  static latest: FakeRecorder;
  static nextStart: (() => Promise<void>) | undefined;
  static nextAudio = new Blob(['audio'], { type: 'audio/mp4' });
  start = vi.fn(FakeRecorder.nextStart ?? (async () => {}));
  stop = vi.fn(() => this.callbacks.onRecording(FakeRecorder.nextAudio));
  cancel = vi.fn();
  constructor(readonly callbacks: AudioRecorderCallbacks) {
    FakeRecorder.latest = this;
  }
}

function setup(attach = vi.fn(async (_file: File) => true)) {
  let now = 1_000;
  const trace = {
    event: vi.fn(),
    span: <T>(
      _name: string,
      operation: (span: { setAttr: () => void }) => Promise<T>
    ) => operation({ setAttr: vi.fn() }),
    setAttr: vi.fn(),
    error: vi.fn(),
    end: vi.fn(),
  };
  const hook = renderHook(() =>
    createVoiceMemo({
      supported: true,
      startTrace: () => trace,
      createRecorder: (callbacks) => new FakeRecorder(callbacks),
      now: () => now,
      recordedAt: () => new Date(2026, 10, 23, 9, 5),
      attach,
    })
  );
  return {
    ...hook,
    attach,
    trace,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('voice memo', () => {
  it('records, stops and attaches the recording once as an audio file', async () => {
    const test = setup();
    await test.result.start();
    expect(test.result.phase()).toBe('recording');

    test.advance(4_200);
    FakeRecorder.latest.callbacks.onLevel?.(0.5);
    expect(test.result.elapsedMs()).toBe(4_200);
    expect(test.result.volumeHistory()).toEqual([0.5]);

    await Promise.all([test.result.stop(), test.result.stop()]);
    expect(test.attach).toHaveBeenCalledOnce();
    const file = test.attach.mock.calls[0][0];
    expect(file.name).toBe('Voice memo 09.05.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(test.result.phase()).toBe('idle');
    expect(test.result.notice()).toBeUndefined();
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'voice_memo.outcome',
      'attached'
    );
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('discards a cancelled recording without attaching it', async () => {
    const test = setup();
    await test.result.start();
    test.result.cancel();
    expect(FakeRecorder.latest.cancel).toHaveBeenCalledOnce();
    expect(test.attach).not.toHaveBeenCalled();
    expect(test.result.phase()).toBe('idle');
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'voice_memo.outcome',
      'cancelled'
    );
  });

  it('never attaches when cancelled during the permission prompt', async () => {
    let grant = () => {};
    FakeRecorder.nextStart = () =>
      new Promise<void>((resolve) => {
        grant = resolve;
      });
    const test = setup();
    const started = test.result.start();
    FakeRecorder.nextStart = undefined;
    expect(test.result.phase()).toBe('starting');
    test.result.cancel();
    grant();
    await started;
    expect(test.result.phase()).toBe('idle');
    expect(FakeRecorder.latest.cancel).toHaveBeenCalled();
    expect(test.attach).not.toHaveBeenCalled();
  });

  it('reports a denied or missing microphone and returns to idle', async () => {
    FakeRecorder.nextStart = async () => {
      throw new DOMException('denied', 'NotAllowedError');
    };
    const test = setup();
    await test.result.start();
    FakeRecorder.nextStart = undefined;
    expect(test.result.phase()).toBe('idle');
    expect(test.result.notice()).toBe('microphone_denied');
    expect(test.trace.setAttr).toHaveBeenCalledWith(
      'voice_memo.outcome',
      'microphone_denied'
    );

    FakeRecorder.nextStart = async () => {
      throw new DOMException('none', 'NotFoundError');
    };
    await test.result.start();
    FakeRecorder.nextStart = undefined;
    expect(test.result.notice()).toBe('microphone_missing');
  });

  it('attaches nothing for an empty recording', async () => {
    FakeRecorder.nextAudio = new Blob([], { type: 'audio/mp4' });
    const test = setup();
    await test.result.start();
    await test.result.stop();
    FakeRecorder.nextAudio = new Blob(['audio'], { type: 'audio/mp4' });
    expect(test.attach).not.toHaveBeenCalled();
    expect(test.result.phase()).toBe('idle');
    expect(test.result.notice()).toBe('empty');
  });

  it('attaches a recording the size or time limit stopped', async () => {
    const test = setup();
    await test.result.start();
    FakeRecorder.latest.callbacks.onLimit?.();
    // The browser recorder stops itself at the limit; its stop hands over
    // the audio exactly as this one does.
    FakeRecorder.nextAudio = new Blob(['audio'], {
      type: 'audio/webm;codecs=opus',
    });
    await test.result.stop();
    FakeRecorder.nextAudio = new Blob(['audio'], { type: 'audio/mp4' });
    expect(test.attach).toHaveBeenCalledOnce();
    expect(test.attach.mock.calls[0][0].name).toBe('Voice memo 09.05.webm');
    expect(test.result.notice()).toBe('limit');
  });

  it('keeps a recording whose upload failed so it can be retried', async () => {
    const attach = vi
      .fn<(file: File) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const test = setup(attach);
    await test.result.start();
    await test.result.stop();
    expect(test.result.phase()).toBe('failed');
    expect(test.result.notice()).toBe('upload_failed');

    await test.result.retry();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1][0]).toBe(attach.mock.calls[0][0]);
    expect(test.result.phase()).toBe('idle');
    expect(test.trace.end).toHaveBeenCalledOnce();
  });

  it('discards a failed recording on cancel', async () => {
    const attach = vi.fn(async (_file: File) => false);
    const test = setup(attach);
    await test.result.start();
    await test.result.stop();
    test.result.cancel();
    expect(test.result.phase()).toBe('idle');
    await test.result.retry();
    expect(attach).toHaveBeenCalledOnce();
  });

  it('ends quietly when another composer takes the microphone', async () => {
    const test = setup();
    await test.result.start();
    FakeRecorder.latest.callbacks.onInterrupted();
    expect(test.result.phase()).toBe('idle');
    expect(test.result.notice()).toBe('interrupted');
    expect(test.attach).not.toHaveBeenCalled();
  });

  it('stays unavailable when the browser cannot record', async () => {
    const createRecorder = vi.fn();
    const hook = renderHook(() =>
      createVoiceMemo({
        supported: false,
        startTrace: vi.fn(),
        createRecorder,
        now: () => 0,
        recordedAt: () => new Date(),
        attach: vi.fn(),
      })
    );
    await hook.result.start();
    expect(hook.result.phase()).toBe('unavailable');
    expect(hook.result.disabled()).toBe(true);
    expect(createRecorder).not.toHaveBeenCalled();
  });
});
