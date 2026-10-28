import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRecording,
  type DesktopSnapshot,
  desktopResourceAttributes,
  type MemorySample,
  memoryAttributes,
} from './desktop';

vi.mock('@core/util/platform', () => ({
  getPlatform: () => 'desktop',
  isTauri: () => true,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

function sample(sequence = 1): MemorySample {
  return {
    sequence,
    timestampMs: 1000,
    frontendStatus: 'available',
    error: null,
    processes: [
      { pid: 1, role: 'native', residentBytes: 100, footprintBytes: 80 },
      { pid: 2, role: 'web_content', residentBytes: 300, footprintBytes: 250 },
      { pid: 3, role: 'gpu', residentBytes: 50, footprintBytes: 40 },
    ],
  };
}
function snapshot(samples: MemorySample[]): DesktopSnapshot {
  return {
    identity: {
      instanceId: 'launch-1',
      recordingId: 'recording-1',
      tracesUrl: 'http://localhost:4318/v1/traces',
      nativeVersion: '2.5.0',
      os: 'macos',
      hostPid: 1,
    },
    samples,
    droppedSamples: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('desktop recording', () => {
  it('separates native, frontend, and app memory without pretending RSS is footprint', () => {
    expect(memoryAttributes(sample())).toMatchObject({
      'macro.memory.native.rss_bytes': 100,
      'macro.memory.native.footprint_bytes': 80,
      'macro.memory.frontend.footprint_bytes': 290,
      'macro.memory.app.footprint_bytes': 370,
    });
    const unavailable = {
      ...sample(),
      frontendStatus: 'unavailable' as const,
      processes: sample().processes.slice(0, 1),
    };
    expect(memoryAttributes(unavailable)).not.toHaveProperty(
      'macro.memory.frontend.footprint_bytes'
    );
    expect(memoryAttributes(unavailable)).not.toHaveProperty(
      'macro.memory.app.footprint_bytes'
    );
    expect(
      memoryAttributes({ ...sample(), frontendStatus: 'partial' })
    ).not.toHaveProperty('macro.memory.app.footprint_bytes');
  });

  it('correlates launches independently of recordings and tags the native runtime', () => {
    const recorded = snapshot([]);
    expect(desktopResourceAttributes(recorded)).toMatchObject({
      'app.runtime': 'tauri',
      'app.platform': 'desktop',
      'service.instance.id': 'launch-1',
      'macro.recording.id': 'recording-1',
      'os.type': 'darwin',
    });
    recorded.identity.recordingId = null;
    expect(desktopResourceAttributes(recorded)).toMatchObject({
      'macro.recording.enabled': false,
      'macro.recording.id': undefined,
    });
  });

  it('exports each new sample once, preserves sample times, and expires stale readings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const sink = { recordSample: vi.fn(), warn: vi.fn() };
    const save = vi.fn();
    const recording = createMemoryRecording(vi.fn(), sink, 1, save);
    recording.accept(snapshot([sample(1), sample(2)]));
    recording.accept(snapshot([sample(2)]));
    expect(sink.recordSample).toHaveBeenCalledTimes(1);
    expect(sink.recordSample).toHaveBeenCalledWith(
      'app.memory.sample',
      expect.any(Object),
      1000
    );
    expect(save).toHaveBeenCalledWith(2);
    expect(recording.attributes()).toMatchObject({
      'macro.memory.status': 'current',
      'macro.memory.sample_age_ms': 1000,
    });
    vi.setSystemTime(7000);
    expect(recording.attributes()).toEqual({
      'macro.memory.status': 'stale',
      'macro.memory.sample_age_ms': 6000,
    });
    recording.dispose();
  });

  it('reports buffer loss and stops polling or accepting results after disposal', async () => {
    vi.useFakeTimers();
    let resolve!: (value: DesktopSnapshot) => void;
    const read = vi.fn(
      () =>
        new Promise<DesktopSnapshot>((r) => {
          resolve = r;
        })
    );
    const sink = { recordSample: vi.fn(), warn: vi.fn() };
    const recording = createMemoryRecording(read, sink);
    recording.accept({ ...snapshot([sample(9)]), droppedSamples: 8 });
    expect(sink.warn).toHaveBeenCalledWith(
      'Native memory recording buffer overflowed',
      { 'macro.memory.dropped_samples': 8 }
    );
    const started = recording.start();
    recording.dispose();
    resolve(snapshot([sample()]));
    await started;
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(sink.recordSample).toHaveBeenCalledTimes(1);
  });

  it('does not report buffer loss for samples already exported before a reload', () => {
    const sink = { recordSample: vi.fn(), warn: vi.fn() };
    const recording = createMemoryRecording(vi.fn(), sink, 10);
    recording.accept({
      ...snapshot([sample(9), sample(10), sample(11)]),
      droppedSamples: 8,
    });
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.recordSample).toHaveBeenCalledTimes(1);
    recording.dispose();
  });
});
