import {
  browserCacheTelemetryContext,
  type CacheRolloutCohort,
  CacheTelemetryRecorder,
  type CacheTelemetryRecorderLike,
  CacheTelemetryReporter,
  type CacheTelemetrySink,
  isCacheTelemetryObservation,
} from './telemetry';
import { createOtelCacheTelemetrySink } from './telemetry-otel';

const CACHE_TELEMETRY_CHANNEL = 'macro:graphql-cache-telemetry:v1';
const CACHE_TELEMETRY_REPORTER_LOCK =
  'macro:graphql-cache-telemetry-reporter:v1';

type BroadcastChannelLike = Pick<
  BroadcastChannel,
  'postMessage' | 'close' | 'onmessage' | 'onmessageerror'
>;

export interface CacheTelemetryRelayOptions {
  createChannel?: (name: string) => BroadcastChannelLike;
  lockManager?: Pick<LockManager, 'request'>;
}

/**
 * Relays typed worker observations through exactly one live browser page.
 * Leadership is a fixed, scope-free Web Lock; no cache or identity key crosses
 * the telemetry channel.
 */
export class CacheTelemetryRelay {
  private channel: BroadcastChannelLike | undefined;
  private abortController: AbortController | undefined;
  private releaseLeadership: (() => void) | undefined;
  private leader = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly reporter: CacheTelemetryReporter,
    private readonly options: CacheTelemetryRelayOptions = {}
  ) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      const createChannel =
        this.options.createChannel ??
        ((name: string) => new BroadcastChannel(name));
      this.channel = createChannel(CACHE_TELEMETRY_CHANNEL);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (this.leader && isCacheTelemetryObservation(event.data)) {
          this.reporter.emit(event.data);
        }
      };
      this.channel.onmessageerror = () => undefined;
    } catch {
      this.channel = undefined;
      return;
    }

    const locks =
      this.options.lockManager ??
      (typeof navigator === 'undefined' ? undefined : navigator.locks);
    if (!locks) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    const held = new Promise<void>((resolve) => {
      this.releaseLeadership = resolve;
    });
    try {
      void locks
        .request(
          CACHE_TELEMETRY_REPORTER_LOCK,
          { mode: 'exclusive', signal: abortController.signal },
          async (lock) => {
            if (!lock || this.disposed) return;
            this.leader = true;
            try {
              await held;
            } finally {
              this.leader = false;
            }
          }
        )
        .catch(() => undefined);
    } catch {
      // A relay failure only drops worker-originated telemetry.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leader = false;
    try {
      this.releaseLeadership?.();
      this.abortController?.abort();
      if (this.channel) {
        this.channel.onmessage = null;
        this.channel.onmessageerror = null;
        this.channel.close();
      }
    } catch {
      // Lifecycle cleanup remains best-effort and exception-isolated.
    }
    this.channel = undefined;
  }
}

/** Page recorder + worker relay, backed by anonymous OpenTelemetry spans. */
export function createPageCacheTelemetry(options: {
  rolloutCohort: CacheRolloutCohort;
  sink?: CacheTelemetrySink;
  relay?: CacheTelemetryRelayOptions;
}): {
  recorder: CacheTelemetryRecorderLike;
  relay: CacheTelemetryRelay;
} {
  const sink = options.sink ?? createOtelCacheTelemetrySink();
  const pageReporter = new CacheTelemetryReporter(
    browserCacheTelemetryContext(options.rolloutCohort),
    sink
  );
  // Worker observations carry no activation context over the scope-free
  // channel, so they must never inherit whichever page won relay leadership.
  const workerReporter = new CacheTelemetryReporter(
    {
      ...browserCacheTelemetryContext('unknown'),
      appVersion: 'unknown',
    },
    sink
  );
  return {
    recorder: new CacheTelemetryRecorder(pageReporter),
    relay: new CacheTelemetryRelay(workerReporter, options.relay),
  };
}

let workerRecorder: CacheTelemetryRecorderLike | undefined;
let workerChannel: BroadcastChannelLike | undefined;

/** Lazy worker recorder. Constructing/importing it creates no worker/channel. */
export function workerCacheTelemetry(): CacheTelemetryRecorderLike {
  workerRecorder ??= new CacheTelemetryRecorder({
    emit(observation): void {
      try {
        workerChannel ??= new BroadcastChannel(CACHE_TELEMETRY_CHANNEL);
        workerChannel.postMessage(observation);
      } catch {
        // Missing/failed BroadcastChannel only drops this observation.
      }
    },
  });
  return workerRecorder;
}
