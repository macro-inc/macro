import { z } from 'zod';
import type { Files } from '../../core/state.ts';
import { Entry, type Table } from './due.ts';

/** Where schedules are kept. One reader and writer at a time: the scheduler serializes its calls. */
export type ScheduleStore = {
  readonly read: () => Promise<Table>;
  readonly write: (table: Table) => Promise<void>;
};

const stored = z.record(z.string(), z.unknown());

/**
 * Schedules as one JSON file, which should be in the scheduling capability's
 * own state directory. An entry that no longer parses is dropped rather than
 * failing the whole file.
 */
export const fileStore = ({
  file,
  files,
}: {
  readonly file: string;
  readonly files: Files;
}): ScheduleStore => ({
  read: async () => {
    const text = await files.read(file);
    if (text === undefined || text.trim() === '') return {};
    // A file that isn't JSON throws rather than reading as empty, which the
    // next write would make true.
    const parsed = stored.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${file} is not a table of schedules`);
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([name, raw]) => {
        const entry = Entry.safeParse(raw);
        return entry.success ? [[name, entry.data]] : [];
      })
    );
  },
  write: (table) => files.write(file, `${JSON.stringify(table, null, '\t')}\n`),
});

/** Schedules kept in memory, e.g. for tests. */
export const memoryStore = (initial: Table = {}): ScheduleStore => {
  let table = initial;
  return {
    read: async () => table,
    write: async (next) => {
      table = next;
    },
  };
};
