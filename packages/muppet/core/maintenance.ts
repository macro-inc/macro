import { AsyncLocalStorage } from 'node:async_hooks';

/** The dispatcher fence for a single runtime invocation. */
export const maintenance = () => {
  let active = 0;
  let eligible = false;
  let token: string | undefined;
  let resume: PromiseWithResolvers<void> | undefined;
  const changed = new Set<() => void>();
  const notify = () => {
    for (const listener of changed) listener();
  };

  const track = <T>(work: () => Promise<T>): Promise<T> => {
    active += 1;
    return tracked.run(track, async () => {
      try {
        return await work();
      } finally {
        active -= 1;
        notify();
      }
    });
  };

  return {
    eligible: (replayable: boolean) => {
      eligible = replayable;
      notify();
    },
    setFence: (next: string | undefined) => {
      if (next === token) return;
      token = next;
      if (next === undefined) {
        resume?.resolve();
        resume = undefined;
      } else {
        resume ??= Promise.withResolvers<void>();
      }
      notify();
    },
    canDrain: () => eligible,
    drained: () => (eligible && active === 0 ? token : undefined),
    change: (listener: () => void) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
    dispatch: async <T>(dependent: boolean, work: () => Promise<T>) => {
      while (!dependent && resume !== undefined) await resume.promise;
      return track(work);
    },
  };
};

const tracked = new AsyncLocalStorage<
  <T>(work: () => Promise<T>) => Promise<T>
>();

/** Keeps detached work in its originating dispatcher's drain until bookkeeping finishes. */
export const trackMaintenanceTask = <T>(work: () => Promise<T>): Promise<T> =>
  tracked.getStore()?.(work) ?? work();

let hosted: ReturnType<typeof maintenance> | undefined;

/** Called by the supervisor's preload before the behavior is imported. */
export const installHostedMaintenance = (
  control: ReturnType<typeof maintenance>
): void => {
  hosted = control;
};

/** The dispatcher installed by the supervisor for this invocation, if any. */
export const hostedMaintenance = ():
  | ReturnType<typeof maintenance>
  | undefined => hosted;

/** Connects the invocation's dispatcher to the supervisor's fence and receipts. */
export const maintenanceReceipts = ({
  control,
  invocation,
  runtime,
  readFence,
  watchFence,
  write,
}: {
  readonly control: ReturnType<typeof maintenance>;
  readonly invocation: string;
  readonly runtime: string;
  readonly readFence: () => string | undefined;
  readonly watchFence: (changed: () => void) => void;
  readonly write: (name: 'ready' | 'drained', value: string) => Promise<void>;
}) => {
  let revision: string | undefined;
  let delivered: string | undefined;
  let writes = Promise.resolve();
  const reportDrain = (): void => {
    const token = control.drained();
    if (token === undefined || token === delivered || revision === undefined)
      return;
    delivered = token;
    writes = writes
      .then(() => write('drained', JSON.stringify({ invocation, token })))
      .catch((error: unknown) => {
        console.error('agent runtime drain receipt failed', error);
      });
  };
  const refresh = () => control.setFence(readFence());
  watchFence(refresh);
  refresh();
  control.change(reportDrain);
  return async (head: string) => {
    if (!control.canDrain()) return;
    await write('ready', JSON.stringify({ invocation, runtime, head }));
    revision = head;
    reportDrain();
  };
};
