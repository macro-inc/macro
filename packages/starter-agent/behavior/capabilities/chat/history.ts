import { type Disk, jsonLine, parseLines } from '../../context/disk.ts';
import { Entry, Queued } from './entry.ts';

/**
 * What the agent keeps of each conversation: its messages, on this machine
 * only, and the ones still waiting for its reply.
 */
export type History = {
  /** The channel's last `count` recorded messages, oldest first. */
  readonly recent: (
    channelId: string,
    count: number
  ) => Promise<readonly Entry[]>;
  readonly record: (channelId: string, entry: Entry) => Promise<void>;
  /** Whether the message was recorded: one read again from history after a restart was already judged. */
  readonly recorded: (channelId: string, id: string) => Promise<boolean>;
  /**
   * Keeps a message that is waiting for a reply, so a restart doesn't lose
   * it. False when it was already waiting: a restart queued it again.
   */
  readonly wait: (message: Queued) => Promise<boolean>;
  /** Forgets the waiting messages with these ids: they were answered. */
  readonly answered: (
    channelId: string,
    ids: readonly string[]
  ) => Promise<void>;
  /** Every message still waiting, e.g. after a restart. */
  readonly waiting: () => Promise<readonly Queued[]>;
};

const extension = '.jsonl';

export const history = ({
  directory,
  queue,
  join,
  disk,
}: {
  /** Where each channel's messages are kept. People's messages: the private bucket. */
  readonly directory: string;
  /** Where waiting messages are kept. */
  readonly queue: string;
  readonly join: (...parts: readonly string[]) => string;
  readonly disk: Pick<Disk, 'read' | 'write' | 'append' | 'list' | 'remove'>;
}): History => {
  const file = (channelId: string) =>
    join(directory, `${channelId}${extension}`);
  const queued = (channelId: string) => join(queue, `${channelId}${extension}`);
  const read = async (path: string) =>
    parseLines(Queued, await disk.read(path));
  // Each channel's recorded ids, read from its file once, so checking a
  // message doesn't parse the whole history each time.
  const ids = new Map<string, Promise<Set<string>>>();
  const recordedIds = (channelId: string) => {
    let known = ids.get(channelId);
    if (known === undefined) {
      known = disk
        .read(file(channelId))
        .then((text) => new Set(parseLines(Entry, text).map(({ id }) => id)));
      // A failed read is read again next time, not kept.
      known.catch(() => ids.delete(channelId));
      ids.set(channelId, known);
    }
    return known;
  };
  return {
    recent: async (channelId, count) =>
      parseLines(Entry, await disk.read(file(channelId))).slice(-count),
    record: async (channelId, entry) => {
      const known = await recordedIds(channelId);
      await disk.append(file(channelId), jsonLine(entry));
      known.add(entry.id);
    },
    recorded: async (channelId, id) => (await recordedIds(channelId)).has(id),
    wait: async (message) => {
      const path = queued(message.channel_id);
      if ((await read(path)).some(({ id }) => id === message.id)) return false;
      await disk.append(path, jsonLine(message));
      return true;
    },
    answered: async (channelId, ids) => {
      const left = (await read(queued(channelId))).filter(
        ({ id }) => !ids.includes(id)
      );
      if (left.length === 0) await disk.remove(queued(channelId));
      else await disk.write(queued(channelId), left.map(jsonLine).join(''));
    },
    waiting: async () =>
      (
        await Promise.all(
          (
            await disk.list(queue)
          )
            .filter((name) => name.endsWith(extension))
            .map((name) => read(join(queue, name)))
        )
      ).flat(),
  };
};
