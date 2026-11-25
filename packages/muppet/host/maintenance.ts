// Preloaded only by the agent supervisor, with paths for this invocation.
import { existsSync, readFileSync, watch } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  installHostedMaintenance,
  maintenance,
  maintenanceReceipts,
  trackMaintenanceTask,
} from '../core/maintenance.ts';

const directory = process.env.MACRO_AGENT_RUNTIME_CONTROL;
const invocation = process.env.INVOCATION_ID;
const runtime = process.env.MACRO_AGENT_RUNTIME_ID;
const head = process.env.MACRO_AGENT_RUNTIME_REVISION;

const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
};

if (directory && invocation && runtime && head) {
  const fault = (error: unknown) => {
    console.error('Agent runtime maintenance bridge:', error);
  };
  try {
    const fence = join(directory, 'fence');
    const receipts = join(directory, 'receipts');
    const replay = read(join(directory, 'replay-schedules'));
    const replayed = join(receipts, 'schedules-replayed');
    const pendingBootReplay = replay !== undefined && read(replayed) !== replay;
    const control = maintenance(
      pendingBootReplay
        ? () => writeFile(replayed, replay)
        : read(fence) === undefined
          ? undefined
          : async () => {}
    );
    const ready = maintenanceReceipts({
      control,
      invocation,
      runtime,
      readFence: () => read(fence),
      watchFence: (refresh) => {
        const update = () => {
          try {
            refresh();
          } catch (error) {
            fault(error);
          }
        };
        // A watcher failure or dropped notification must not strand the
        // dispatcher with its previously observed fence.
        watch(directory, (_event, name) => {
          if (name === 'fence' || name === null) update();
        })
          .on('error', fault)
          .unref();
        setInterval(update, 1000).unref();
      },
      write: async (name, contents) => {
        const target = join(receipts, name);
        const temporary = `${target}.${invocation}.new`;
        await writeFile(temporary, contents);
        await rename(temporary, target);
      },
    });

    installHostedMaintenance(control);
    Reflect.set(globalThis, Symbol.for('macro.agent.runtime-maintenance'), {
      ready: async () => {
        try {
          await ready(head);
        } catch (error) {
          fault(error);
          if (control.fenced()) throw error;
        }
      },
      track: (task: Promise<unknown>) => {
        void trackMaintenanceTask(() => task).catch(() => undefined);
      },
    });
  } catch (error) {
    // A normal boot can keep working and will have no rollout receipt.
    // A candidate started under the fence must fail before doing any work.
    fault(error);
    if (existsSync(join(directory, 'fence'))) throw error;
  }
}
