import { getPlatform, isTauri } from '@core/util/platform';
import { type Attributes, Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';

export type ProcessMemory = {
  pid: number;
  role: 'native' | 'web_content' | 'gpu' | 'network';
  residentBytes: number;
  footprintBytes: number;
};

export type MemorySample = {
  sequence: number;
  timestampMs: number;
  processes: ProcessMemory[];
  frontendStatus: 'available' | 'partial' | 'unavailable';
  error: string | null;
};

export type DesktopSnapshot = {
  identity: {
    instanceId: string;
    recordingId: string | null;
    tracesUrl: string | null;
    nativeVersion: string;
    os: string;
    hostPid: number;
  };
  samples: MemorySample[];
  droppedSamples: number;
};

type SampleSink = {
  recordSample: typeof Telemetry.recordSample;
  warn: typeof Telemetry.warn;
};

/** Preserve missing coverage instead of reporting unavailable memory as zero. */
export function memoryAttributes(sample: MemorySample): Attributes {
  const attributes: Attributes = {
    'macro.memory.timestamp_ms': sample.timestampMs,
    'macro.memory.sequence': sample.sequence,
    'macro.memory.frontend.status': sample.frontendStatus,
  };
  for (const role of ['native', 'web_content', 'gpu', 'network'] as const) {
    const processes = sample.processes.filter(
      (process) => process.role === role
    );
    if (!processes.length) continue;
    attributes[`macro.memory.${role}.rss_bytes`] = processes.reduce(
      (sum, process) => sum + process.residentBytes,
      0
    );
    attributes[`macro.memory.${role}.footprint_bytes`] = processes.reduce(
      (sum, process) => sum + process.footprintBytes,
      0
    );
    attributes[`macro.memory.${role}.process_count`] = processes.length;
    attributes[`macro.memory.${role}.pids`] = processes.map(
      (process) => process.pid
    );
  }
  if (sample.frontendStatus !== 'unavailable') {
    attributes['macro.memory.frontend.footprint_bytes'] = sample.processes
      .filter((process) => process.role !== 'native')
      .reduce((sum, process) => sum + process.footprintBytes, 0);
  }
  if (
    sample.frontendStatus === 'available' &&
    sample.processes.some((p) => p.role === 'native')
  ) {
    attributes['macro.memory.app.footprint_bytes'] = sample.processes.reduce(
      (sum, process) => sum + process.footprintBytes,
      0
    );
  }
  return attributes;
}

export function desktopResourceAttributes(
  snapshot: DesktopSnapshot
): Attributes {
  return {
    'app.runtime': 'tauri',
    'app.platform': getPlatform(),
    'service.instance.id': snapshot.identity.instanceId,
    'macro.recording.id': snapshot.identity.recordingId ?? undefined,
    'macro.recording.enabled': snapshot.identity.recordingId !== null,
    'macro.native.version': snapshot.identity.nativeVersion,
    'os.type':
      snapshot.identity.os === 'macos' ? 'darwin' : snapshot.identity.os,
    'macro.native.pid': snapshot.identity.hostPid,
  };
}

/** Native samples keep their original times, including after a webview pause. */
export function createMemoryRecording(
  read: (afterSequence: number) => Promise<DesktopSnapshot>,
  sink: SampleSink,
  initialSequence = 0,
  saveSequence: (sequence: number) => void = () => {}
) {
  let sequence = initialSequence;
  let latest: MemorySample | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  function accept(snapshot: DesktopSnapshot) {
    if (disposed) return;
    // Bootstrap reads the entire native buffer, even when this webview has a
    // saved cursor. Only report samples missing after our own cursor.
    const firstNewSample = snapshot.samples.find(
      (sample) => sample.sequence > sequence
    );
    const droppedSamples = firstNewSample
      ? firstNewSample.sequence - sequence - 1
      : 0;
    if (droppedSamples > 0) {
      sink.warn('Native memory recording buffer overflowed', {
        'macro.memory.dropped_samples': droppedSamples,
      });
    }
    for (const sample of snapshot.samples) {
      if (sample.sequence <= sequence) continue;
      latest = sample;
      sink.recordSample(
        'app.memory.sample',
        memoryAttributes(sample),
        sample.timestampMs
      );
      if (sample.error && sample.error !== lastError) {
        sink.warn('Native memory recording has incomplete coverage', {
          'macro.memory.error': sample.error,
        });
      }
      lastError = sample.error;
      sequence = sample.sequence;
      saveSequence(sequence);
    }
  }
  let lastError: string | null = null;

  async function poll() {
    if (disposed || pending) return;
    pending = true;
    try {
      accept(await read(sequence));
    } catch (error) {
      sink.warn('Unable to read native memory samples', {
        'error.message': error instanceof Error ? error.message : String(error),
      });
    } finally {
      pending = false;
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    }
  }

  return {
    accept,
    start: poll,
    attributes(): Attributes {
      if (!latest) return { 'macro.memory.status': 'pending' };
      const age = Math.max(0, Date.now() - latest.timestampMs);
      if (age > 5000) {
        return {
          'macro.memory.status': 'stale',
          'macro.memory.sample_age_ms': age,
        };
      }
      return {
        ...memoryAttributes(latest),
        'macro.memory.status': 'current',
        'macro.memory.sample_age_ms': age,
      };
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

export async function readDesktopDiagnostics(): Promise<
  DesktopSnapshot | undefined
> {
  if (!isTauri()) return undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<DesktopSnapshot>('read_desktop_diagnostics'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Native diagnostics timed out')),
          3000
        );
      }),
    ]);
  } catch (error) {
    // Older binaries may receive a newer frontend bundle without this command.
    console.warn('[telemetry] Native diagnostics unavailable', error);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function createDesktopMemoryRecording(snapshot: DesktopSnapshot) {
  const key = `macro-memory-sequence:${snapshot.identity.instanceId}`;
  let sequence = 0;
  try {
    const saved = Number(sessionStorage.getItem(key));
    if (Number.isSafeInteger(saved) && saved >= 0) sequence = saved;
  } catch {
    /* Storage may be disabled; telemetry still works. */
  }
  return createMemoryRecording(
    (afterSequence) =>
      invoke<DesktopSnapshot>('read_desktop_diagnostics', { afterSequence }),
    Telemetry,
    sequence,
    (value) => {
      try {
        sessionStorage.setItem(key, String(value));
      } catch {
        /* Best effort. */
      }
    }
  );
}
