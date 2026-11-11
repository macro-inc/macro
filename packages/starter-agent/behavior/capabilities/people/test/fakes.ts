import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { Disk } from '../../../context/disk.ts';
import type { Log } from '../../../context/log.ts';
import type { Ask, Said } from '../appraise.ts';
import { type Keeping, keeping } from '../keep.ts';
import type { ActName, Event, Importance, Who } from '../rules.ts';
import { memoryStore, type Store } from '../store.ts';

export const now = Temporal.Instant.from('2026-11-05T12:00:00Z');
export const who: Who = {
  me: 'macro|agent@example.com',
  owner: 'macro|owner@example.com',
  name: 'Pip',
};
export const ada = 'macro|ada@example.com';

/** A clock that stands still. */
export const clock: Clock = { now: () => now, sleep: async () => undefined };

export const ago = (days: number): string =>
  now.subtract({ hours: 24 * days }).toString();

export const event = (
  act: ActName,
  importance: Importance = 2,
  days = 1,
  extra: Partial<Event> = {}
): Event => ({
  at: ago(days),
  act,
  importance,
  note: `${act} note`,
  private: false,
  source: `s-${act}-${days}`,
  ...extra,
});

export const said = (
  id: string,
  sender = ada,
  text = 'something long enough to read',
  dm = false
): Said => ({ id, sender_id: sender, from: 'A', at: ago(0), text, dm });

/** A disk in memory, which also remembers what was made private. */
export const memoryDisk = () => {
  const files = new Map<string, string>();
  const disk: Disk = {
    read: async (path) => files.get(path),
    write: async (path, text) => {
      files.set(path, text);
    },
    append: async (path, text) => {
      files.set(path, `${files.get(path) ?? ''}${text}`);
    },
    remove: async (path) => {
      for (const name of [...files.keys()])
        if (name === path || name.startsWith(`${path}/`)) files.delete(name);
    },
    rename: async (from, to) => {
      const text = files.get(from);
      if (text === undefined) return false;
      files.set(to, text);
      files.delete(from);
      return true;
    },
    list: async (directory) =>
      [...files.keys()]
        .filter((name) => name.startsWith(`${directory}/`))
        .map((name) => name.slice(directory.length + 1))
        .filter((name) => !name.includes('/'))
        .sort(),
    exists: async (path) => files.has(path),
    modified: async () => undefined,
    makeDirectory: async () => undefined,
  };
  return { disk, files };
};

export const join = (...parts: readonly string[]): string => parts.join('/');

/** A log kept in memory: each entry with the stream it went to. */
export const memoryLog = () => {
  const entries: { readonly stream: string; readonly entry: object }[] = [];
  const log: Log = {
    event: async (stream, entry) => {
      entries.push({ stream, entry });
    },
    file: (stream) => stream,
  };
  return { log, entries };
};

/** The area's working parts over memory, with a model that answers as told. */
export const kept = ({
  ask = async () => '{}',
  store = memoryStore({ clock }),
  recent = async () => [],
}: {
  readonly ask?: Ask;
  readonly store?: Store;
  readonly recent?: (channelId: string) => Promise<readonly Said[]>;
} = {}): {
  readonly keeping: Keeping;
  readonly store: Store;
  readonly entries: readonly {
    readonly stream: string;
    readonly entry: object;
  }[];
  readonly log: Log;
} => {
  const { log, entries } = memoryLog();
  return {
    store,
    entries,
    log,
    keeping: keeping({
      store,
      who,
      ask,
      authorOf: async () => ({ id: ada, name: 'Ada', dm: false }),
      recent,
      log,
      stream: 'people',
      clock,
    }),
  };
};
