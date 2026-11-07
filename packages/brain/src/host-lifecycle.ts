import type { ChildProcess } from 'node:child_process';
import { withSpan } from './telemetry.ts';

/** A generation must finish draining before another owns its workspace queues. */
export type HostShutdown = {
  terminate(): void;
  forceStop(): void;
  exited: Promise<void>;
};
export async function stopHost(
  host: HostShutdown,
  graceMs = 30_000
): Promise<void> {
  await withSpan(
    'brain.host.stop',
    { 'drain.grace_ms': graceMs },
    async (span) => {
      const failed = Promise.withResolvers<never>();
      const deadline = setTimeout(() => {
        span.setAttribute('drain.forced', true);
        try {
          host.forceStop();
        } catch (error) {
          failed.reject(error);
        }
      }, graceMs);
      try {
        host.terminate();
        // A force-stop request alone does not transfer ownership: wait for exit.
        await Promise.race([host.exited, failed.promise]);
      } finally {
        clearTimeout(deadline);
      }
    }
  );
}

/** Only for a host spawned detached, whose PID is its own process-group ID. */
export function killHostGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('invalid host process group');
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}

type HealthReply = {
  type: 'brain.health.result';
  requestId: string;
  healthy: boolean;
};
/** A prepared intake is buffering, not an active event consumer. */
export async function hostHealthReply(
  message: unknown,
  active: boolean,
  health: () => Promise<{ status: string }>
): Promise<HealthReply | undefined> {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== 'brain.health' ||
    !('requestId' in message) ||
    typeof message.requestId !== 'string'
  )
    return;
  let healthy = false;
  if (active) {
    try {
      healthy = (await health()).status === 'ok';
    } catch {
      /* A failed health check is unhealthy. */
    }
  }
  return { type: 'brain.health.result', requestId: message.requestId, healthy };
}

/** Probe this child over its private IPC channel, never a shared control port. */
export function hostHealthy(
  child: ChildProcess,
  timeoutMs = 2000
): Promise<boolean> {
  if (!child.connected) return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const finished = (healthy: boolean) => {
      clearTimeout(deadline);
      child.removeListener('message', received);
      child.removeListener('exit', exited);
      child.removeListener('disconnect', exited);
      resolve(healthy);
    };
    const exited = () => finished(false);
    const received = (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'brain.health.result' &&
        'requestId' in message &&
        message.requestId === requestId &&
        'healthy' in message &&
        typeof message.healthy === 'boolean'
      )
        finished(message.healthy);
    };
    const deadline = setTimeout(exited, timeoutMs);
    child.on('message', received);
    child.once('exit', exited);
    child.once('disconnect', exited);
    try {
      child.send({ type: 'brain.health', requestId }, (error) => {
        if (error) finished(false);
      });
    } catch {
      finished(false);
    }
  });
}

/** Observe termination of the host process independently of its output pipes. */
export function trackHostExit(child: ChildProcess): {
  done: Promise<void>;
  exited(): boolean;
} {
  let exited = false;
  const done = new Promise<void>((resolve) => {
    child.on('error', () => {
      // Only failure to spawn is termination; later IPC/signal errors are not.
      if (child.pid === undefined) {
        exited = true;
        resolve();
      }
    });
    child.once('exit', () => {
      exited = true;
      resolve();
    });
  });
  return { done, exited: () => exited };
}
