/**
 * Keeps what the agent records bounded, so it can run indefinitely. Per-run files
 * and recordings older than the limit go; append-only logs and channel
 * history keep their newest lines (trimmed only at twice the cap, so rarely).
 * What is pruned is a list of rules, so an area with files of its own adds a
 * rule instead of a path here.
 */
import type { Disk } from '../../context/disk.ts';

/** One thing in a directory. */
export type Entry = {
  readonly name: string;
  readonly directory: boolean;
  readonly modified: Temporal.Instant;
};

/** Listing a directory with what each thing is, which `Disk` doesn't say. */
export type Tree = {
  /** The directory's entries, or none if it isn't there. */
  readonly entries: (directory: string) => Promise<readonly Entry[]>;
};

export type Rule =
  /**
   * A directory of logs: its `.jsonl` files are append-only and keep their
   * newest `lines`; its other files are per-run and go after `days`; and each
   * thing inside its subdirectories (a call's recordings, one run's output)
   * goes whole after `days`. Per-run files are told by what they aren't, not
   * by a pattern in their name, so a new kind of log can't escape pruning
   * by being named differently.
   */
  | {
      readonly kind: 'logs';
      readonly directory: string;
      readonly days: number;
      readonly lines: number;
    }
  /** A directory of per-run files (records, prompts, copies of mail): each goes after `days`. */
  | {
      readonly kind: 'expire';
      readonly directory: string;
      readonly days: number;
    }
  /** A directory of append-only `.jsonl` files (a channel's history): each keeps its newest `lines`. */
  | {
      readonly kind: 'trim';
      readonly directory: string;
      readonly lines: number;
    }
  /** One append-only file. */
  | {
      readonly kind: 'trimFile';
      readonly file: string;
      readonly lines: number;
    };

const appendOnly = '.jsonl';
const hoursInDay = 24;

/** `find -mtime +days`: whole days of age, rounded down, above the limit. */
export const expired = (
  modified: Temporal.Instant,
  now: Temporal.Instant,
  days: number
): boolean =>
  Math.floor(now.since(modified).total({ unit: 'hours' }) / hoursInDay) > days;

/** The text cut to its newest `keep` lines, or undefined to leave it alone. */
export const trimmed = (text: string, keep: number): string | undefined => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length > 2 * keep
    ? `${lines.slice(-keep).join('\n')}\n`
    : undefined;
};

export type Action =
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'trim'; readonly path: string; readonly lines: number };

/** What a rule does to its directory, given what is in it now. It only lists; nothing is changed here. */
export const actions = async (
  rule: Rule,
  {
    tree,
    join,
    now,
  }: {
    readonly tree: Tree;
    readonly join: (...parts: readonly string[]) => string;
    readonly now: Temporal.Instant;
  }
): Promise<readonly Action[]> => {
  if (rule.kind === 'trimFile')
    return [{ kind: 'trim', path: rule.file, lines: rule.lines }];
  const entries = await tree.entries(rule.directory);
  const path = (name: string) => join(rule.directory, name);
  const old = (entry: Entry, days: number) =>
    expired(entry.modified, now, days);
  if (rule.kind === 'trim')
    return entries
      .filter(({ name, directory }) => !directory && name.endsWith(appendOnly))
      .map(({ name }) => ({
        kind: 'trim',
        path: path(name),
        lines: rule.lines,
      }));
  if (rule.kind === 'expire')
    return entries
      .filter((entry) => !entry.directory && old(entry, rule.days))
      .map(({ name }) => ({ kind: 'remove', path: path(name) }));
  const nested = await Promise.all(
    entries
      .filter(({ directory }) => directory)
      .map(async ({ name }) =>
        (await tree.entries(path(name)))
          .filter((entry) => old(entry, rule.days))
          .map(
            (entry): Action => ({
              kind: 'remove',
              path: join(path(name), entry.name),
            })
          )
      )
  );
  return [
    ...entries.flatMap((entry): readonly Action[] => {
      if (entry.directory) return [];
      if (entry.name.endsWith(appendOnly))
        return [{ kind: 'trim', path: path(entry.name), lines: rule.lines }];
      return old(entry, rule.days)
        ? [{ kind: 'remove', path: path(entry.name) }]
        : [];
    }),
    ...nested.flat(),
  ];
};

export type Pruned = { readonly removed: number; readonly trimmed: number };

/** Applies every rule. A rule that fails doesn't stop the others. */
export const prune = async ({
  rules,
  tree,
  disk,
  join,
  now,
}: {
  readonly rules: readonly Rule[];
  readonly tree: Tree;
  readonly disk: Pick<Disk, 'read' | 'write' | 'remove'>;
  readonly join: (...parts: readonly string[]) => string;
  readonly now: Temporal.Instant;
}): Promise<Pruned> => {
  const planned = (
    await Promise.all(
      rules.map((rule) =>
        actions(rule, { tree, join, now }).catch((): readonly Action[] => [])
      )
    )
  ).flat();
  let removed = 0;
  let cut = 0;
  for (const action of planned) {
    if (action.kind === 'remove') {
      await disk.remove(action.path);
      removed += 1;
      continue;
    }
    const text = await disk.read(action.path);
    const kept = text === undefined ? undefined : trimmed(text, action.lines);
    if (kept === undefined) continue;
    // Whole-file and atomic, so a reader never sees half a log.
    await disk.write(action.path, kept);
    cut += 1;
  }
  return { removed, trimmed: cut };
};
