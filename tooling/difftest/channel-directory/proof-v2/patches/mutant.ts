// Planted mutants for the differential harness, branch tree only. The page
// chooses one with localStorage `proof:mutant`; without it the directory is
// returned untouched. Never committed to a PR branch.
import { untrack } from 'solid-js';
import type {
  ChannelDirectory,
  ChannelLookup,
  DirectoryChannel,
} from '@core/context/channels';

type Rows = readonly DirectoryChannel[];

function readMutant(): string | null {
  try {
    return localStorage.getItem('proof:mutant');
  } catch {
    return null;
  }
}

function smallestId(rows: Rows): string | undefined {
  let found: string | undefined;
  for (const row of rows) if (found === undefined || row.id < found) found = row.id;
  return found;
}

function evenHash(id: string): boolean {
  let sum = 0;
  for (let i = 0; i < id.length; i += 1) sum = (sum + id.charCodeAt(i)) % 1024;
  return sum % 2 === 0;
}

const STALE_KEY = 'proof:stale';

function loadStale(): Record<string, DirectoryChannel> {
  try {
    return JSON.parse(localStorage.getItem(STALE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function proofMutant(directory: ChannelDirectory): ChannelDirectory {
  const kind = readMutant();
  if (!kind) return directory;
  (window as any).__proofMutant = kind;

  if (kind === 'drop') {
    const rows = () => {
      const all = directory.channels();
      const victim = smallestId(all);
      return { all: all.filter((row) => row.id !== victim), victim };
    };
    return {
      ...directory,
      channels: () => rows().all,
      lookup: (id) => (id === rows().victim ? { status: 'missing' } : directory.lookup(id)),
      readComplete: async () => {
        const all = await directory.readComplete();
        const victim = smallestId(all);
        return all.filter((row) => row.id !== victim);
      },
    };
  }

  if (kind === 'swap') {
    const swap = (all: Rows) =>
      all.length < 2 ? all : [all[1]!, all[0]!, ...all.slice(2)];
    return {
      ...directory,
      channels: () => swap(directory.channels()),
      readComplete: async () => swap(await directory.readComplete()),
    };
  }

  if (kind === 'alter') {
    const alter = (row: DirectoryChannel, victim: string | undefined) =>
      row.id === victim ? { ...row, name: `${row.name ?? ''}·` } : row;
    return {
      ...directory,
      channels: () => {
        const all = directory.channels();
        const victim = smallestId(all);
        return all.map((row) => alter(row, victim));
      },
      lookup: (id) => {
        const result = directory.lookup(id);
        if (result.status !== 'loaded') return result;
        const victim = smallestId(directory.channels());
        return { status: 'loaded', channel: alter(result.channel, victim) };
      },
      readComplete: async () => {
        const all = await directory.readComplete();
        const victim = smallestId(all);
        return all.map((row) => alter(row, victim));
      },
    };
  }

  if (kind === 'stale') {
    const stale = loadStale();
    let dirty = false;
    const persist = () => {
      if (!dirty) return;
      dirty = false;
      try {
        localStorage.setItem(STALE_KEY, JSON.stringify(stale));
      } catch {
        // A full or blocked store keeps the in-memory copies.
      }
    };
    const pin = (row: DirectoryChannel): DirectoryChannel => {
      if (!evenHash(row.id)) return row;
      const kept = stale[row.id];
      if (kept) return kept;
      stale[row.id] = row;
      dirty = true;
      return row;
    };
    const pinAll = (all: Rows) => {
      const out = all.map(pin);
      persist();
      return out;
    };
    return {
      ...directory,
      channels: () => pinAll(directory.channels()),
      lookup: (id): ChannelLookup => {
        const result = directory.lookup(id);
        if (result.status !== 'loaded') return result;
        const channel = pin(result.channel);
        persist();
        return { status: 'loaded', channel };
      },
      readComplete: async () => pinAll(await directory.readComplete()),
    };
  }

  if (kind === 'skip-live') {
    let frozen: Rows | undefined;
    const current = () => {
      const all = directory.channels();
      if (frozen) return frozen;
      if (directory.complete()) frozen = untrack(() => [...all]);
      return all;
    };
    return {
      ...directory,
      channels: current,
      lookup: (id): ChannelLookup => {
        current();
        if (!frozen) return directory.lookup(id);
        const row = frozen.find((channel) => channel.id === id);
        return row ? { status: 'loaded', channel: row } : { status: 'missing' };
      },
      readComplete: async () => {
        await directory.readComplete();
        return current();
      },
    };
  }

  return directory;
}
