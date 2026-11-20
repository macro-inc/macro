import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { Disk } from '../disk.ts';

/** A disk in memory. Directories exist when something is in them. */
export const memoryDisk = (
  initial: Readonly<Record<string, string>> = {}
): Disk & { readonly files: Map<string, string> } => {
  const files = new Map(Object.entries(initial));
  const epoch = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    files,
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
      files.delete(from);
      files.set(to, text);
      return true;
    },
    list: async (directory) =>
      [
        ...new Set(
          [...files.keys()]
            .filter((name) => name.startsWith(`${directory}/`))
            .map((name) => name.slice(directory.length + 1).split('/')[0] ?? '')
        ),
      ].sort(),
    exists: async (path) =>
      files.has(path) ||
      [...files.keys()].some((name) => name.startsWith(`${path}/`)),
    modified: async (path) => (files.has(path) ? epoch : undefined),
    makeDirectory: async () => undefined,
  };
};

/** A clock that only moves when told to. Sleeping moves it. */
export const fixedClock = (
  start: string
): Clock & { readonly advance: (milliseconds: number) => void } => {
  let now = Temporal.Instant.from(start);
  const advance = (milliseconds: number): void => {
    now = now.add({ milliseconds });
  };
  return {
    now: () => now,
    sleep: async (milliseconds) => advance(milliseconds),
    advance,
  };
};

export const join = (...parts: readonly string[]): string => parts.join('/');
