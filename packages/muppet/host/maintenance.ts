// Preloaded only by the agent supervisor, with paths for this invocation.
import { readFileSync, watch } from 'node:fs';
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

if (directory && invocation && runtime && head) {
  const control = maintenance();
  const ready = maintenanceReceipts({
    control,
    invocation,
    runtime,
    readFence: () => {
      try {
        return readFileSync(join(directory, 'fence'), 'utf8').trim();
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return undefined;
        throw error;
      }
    },
    watchFence: (refresh) => {
      watch(directory, (_event, name) => {
        if (name === 'fence' || name === null) refresh();
      }).unref();
    },
    write: async (name, contents) => {
      const target = join(directory, 'receipts', name);
      const temporary = `${target}.${invocation}.new`;
      await writeFile(temporary, contents);
      await rename(temporary, target);
    },
  });

  installHostedMaintenance(control);
  Reflect.set(globalThis, Symbol.for('macro.agent.runtime-maintenance'), {
    ready: () => ready(head),
    track: (task: Promise<unknown>) => {
      void trackMaintenanceTask(() => task).catch(() => undefined);
    },
  });
}
