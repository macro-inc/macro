import { createHash } from 'node:crypto';

/** An item to open: its exact list title, and its id to check the route. */
export type TargetItem = { name: string; id: string };

/** The kinds of item a scenario opens. */
export type TargetKey = 'channel' | 'smallDocument' | 'largeDocument';

/**
 * The targets file. It names real account content, so it lives outside the
 * repository (see README.md). `channel` is one channel; `channels` is an
 * ordered list of candidates, of which each iteration opens the first that
 * shows no unread. Both may be set: `channel` is then the first candidate.
 */
export type TargetsFile = {
  channel?: TargetItem;
  channels?: TargetItem[];
  /** Both documents must be listed under Files › Shared with me. */
  smallDocument?: TargetItem;
  largeDocument?: TargetItem;
};

/** The items one iteration opens: one per key, candidates already chosen. */
export type Targets = Partial<Record<TargetKey, TargetItem>>;

/**
 * Which candidate an iteration used, without naming it: its position in the
 * targets file, how many candidates there were, and a short hash of its id,
 * so results taken with an edited file still tell targets apart.
 */
export type TargetChoice = {
  key: TargetKey;
  index: number;
  of: number;
  fingerprint: string;
};

/** What a candidate's list row showed. */
export type Observation = 'quiet' | 'unread' | 'missing';

function item(value: unknown, path: string): TargetItem {
  const entry = value as Partial<TargetItem> | null;
  if (
    typeof entry !== 'object' ||
    entry === null ||
    typeof entry.name !== 'string' ||
    !entry.name.trim() ||
    typeof entry.id !== 'string' ||
    !entry.id.trim()
  )
    throw new Error(`${path} must be { "name": "<title>", "id": "<id>" }`);
  return { name: entry.name, id: entry.id };
}

/** Parses and checks the targets file; a missing key is allowed. */
export function parseTargets(text: string, source = 'the targets file'): TargetsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`${source} must be a JSON object`);
  const raw = parsed as Record<string, unknown>;
  const file: TargetsFile = {};
  for (const key of ['channel', 'smallDocument', 'largeDocument'] as const)
    if (raw[key] !== undefined) file[key] = item(raw[key], `${source}: ${key}`);
  if (raw.channels !== undefined) {
    if (!Array.isArray(raw.channels) || raw.channels.length === 0)
      throw new Error(`${source}: channels must be a non-empty list`);
    file.channels = raw.channels.map((entry, index) =>
      item(entry, `${source}: channels[${index}]`)
    );
  }
  return file;
}

/** The candidates for `key`, in the order they are tried. */
export function candidates(file: TargetsFile, key: TargetKey): TargetItem[] {
  if (key !== 'channel') return file[key] ? [file[key]] : [];
  return [...(file.channel ? [file.channel] : []), ...(file.channels ?? [])];
}

/** A short, stable hash of an id: tells targets apart without naming them. */
export function fingerprint(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}

const DESCRIPTIONS: Record<Exclude<Observation, 'quiet'>, string> = {
  unread: 'shows unread',
  missing: 'is not in the list',
};

/** No candidate could be opened; `onlyUnread` when each one was there but unread. */
export class NoCandidateError extends Error {
  constructor(
    message: string,
    readonly onlyUnread: boolean
  ) {
    super(message);
  }
}

/**
 * Picks the first candidate whose row shows no unread, looking at each in
 * order and none after it: finding a row can mean scrolling a long list.
 * Throws, naming each candidate by position, when none can be opened.
 */
export async function chooseCandidate(
  key: TargetKey,
  items: readonly TargetItem[],
  observe: (item: TargetItem) => Promise<Observation>
): Promise<{ choice: TargetChoice; skipped: string[] }> {
  if (items.length === 0)
    throw new Error(
      `Set ${key === 'channel' ? 'channel or channels' : key} in the targets file`
    );
  const skipped: string[] = [];
  let onlyUnread = true;
  for (const [index, candidate] of items.entries()) {
    const observation = await observe(candidate);
    onlyUnread &&= observation === 'unread';
    if (observation === 'quiet')
      return {
        choice: { key, index, of: items.length, fingerprint: fingerprint(candidate.id) },
        skipped,
      };
    skipped.push(`${key} candidate ${index} ${DESCRIPTIONS[observation]}`);
  }
  throw new NoCandidateError(
    `No ${key} candidate can be opened: ${skipped.join('; ')}`,
    onlyUnread
  );
}
