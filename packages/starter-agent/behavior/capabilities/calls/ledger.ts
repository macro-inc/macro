/**
 * The small files calls keep: append-only ledgers (one JSON row per line,
 * which are the queue, the audit log, and what the limits count), and lists
 * of ids. Every reader parses with the row's schema, so a line that doesn't
 * fit is dropped, never trusted.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import {
  type Disk,
  jsonLine,
  parseLines,
  readJson,
} from '../../context/disk.ts';
import { atText } from './types.ts';

export type Ledger<Row, New> = {
  readonly read: () => Promise<readonly Row[]>;
  /** Appends a row, stamped with the time unless it brings its own. */
  readonly add: (row: New) => Promise<void>;
};

export const ledger = <Row, New extends { readonly at?: Temporal.Instant }>({
  file,
  schema,
  disk,
  clock,
}: {
  readonly file: string;
  readonly schema: z.ZodType<Row>;
  readonly disk: Pick<Disk, 'read' | 'append'>;
  readonly clock: Pick<Clock, 'now'>;
}): Ledger<Row, New> => ({
  read: async () => parseLines(schema, await disk.read(file)),
  add: ({ at, ...row }) =>
    disk.append(file, jsonLine({ at: atText(at ?? clock.now()), ...row })),
});

const Ids = z.array(z.string());

/** A file holding a list of ids, e.g. the channels it always joins. */
export type IdList = {
  readonly read: () => Promise<ReadonlySet<string>>;
  readonly add: (id: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
};

export const idList = ({
  file,
  disk,
  keep,
}: {
  readonly file: string;
  readonly disk: Pick<Disk, 'read' | 'write'>;
  /** Only the newest this many are kept; all of them if absent, sorted. */
  readonly keep?: number;
}): IdList => {
  const read = async () => (await readJson(disk, file, Ids)) ?? [];
  const write = (ids: readonly string[]) =>
    disk.write(
      file,
      `${JSON.stringify(keep === undefined ? [...ids].sort() : ids.slice(-keep))}\n`
    );
  return {
    read: async () => new Set(await read()),
    add: async (id) => {
      const ids = await read();
      if (!ids.includes(id)) await write([...ids, id]);
    },
    remove: async (id) => {
      const ids = await read();
      if (ids.includes(id)) await write(ids.filter((other) => other !== id));
    },
  };
};

/** How many calls the hung-up list remembers. */
export const hungUpKept = 50;
