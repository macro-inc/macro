/**
 * One heartbeat tick: commit and sync the agent's repository, prune, and
 * snapshot what the agent watches; wake it when the snapshot changed and has
 * something in it. Otherwise nothing happens. The decision is pure; `beat` is
 * given everything it touches, so a whole tick runs in a test.
 */
import type { Woke } from '@macro-inc/muppet/core/agent';
import { isoText } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';

/** What the last tick that saw the snapshot change left for the next one. */
export const Cursor = z.object({
  /** The hash of that snapshot. */
  hash: z.string(),
  /** When a tick last woke the agent, if one has. */
  lastRun: z.string().optional(),
});
export type Cursor = z.infer<typeof Cursor>;

const hashLength = 16;

/** The first 16 hex digits of the sha256 of the snapshot plus a newline: short enough to log, long enough never to collide. */
export const snapshotHash = (
  digest: (text: string) => string,
  snapshot: string
): string => digest(`${snapshot}\n`).slice(0, hashLength);

export type WakeFacts = {
  readonly hash: string;
  readonly lastHash: string | undefined;
  readonly snapshot: string;
};

/**
 * Why to wake, or undefined to stay asleep. Only a change wakes, and only to
 * something: a snapshot that went empty means what was there is settled,
 * which needs nobody.
 */
export const wakeReason = ({
  hash,
  lastHash,
  snapshot,
}: WakeFacts): string | undefined =>
  hash !== lastHash && snapshot.trim() !== '' ? 'snapshot changed' : undefined;

/**
 * What changed between two snapshots, for the agent to read: lines only in the old
 * one as `< line`, lines only in the new one as `> line`, in order. Empty
 * when they are the same.
 */
export const snapshotDiff = (before: string, after: string): string => {
  const old = before.split('\n');
  const now = after.split('\n');
  // The longest common subsequence, by length of the best match from each pair of positions on.
  const best = Array.from({ length: old.length + 1 }, () =>
    Array.from({ length: now.length + 1 }, () => 0)
  );
  const at = (i: number, j: number): number => best[i]?.[j] ?? 0;
  for (let i = old.length - 1; i >= 0; i -= 1)
    for (let j = now.length - 1; j >= 0; j -= 1) {
      const row = best[i];
      if (row !== undefined)
        row[j] =
          old[i] === now[j]
            ? at(i + 1, j + 1) + 1
            : Math.max(at(i + 1, j), at(i, j + 1));
    }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length || j < now.length) {
    if (i < old.length && j < now.length && old[i] === now[j]) {
      i += 1;
      j += 1;
    } else if (
      j >= now.length ||
      (i < old.length && at(i + 1, j) >= at(i, j + 1))
    ) {
      lines.push(`< ${old[i]}`);
      i += 1;
    } else {
      lines.push(`> ${now[j]}`);
      j += 1;
    }
  }
  return lines.join('\n');
};

/** The request for one wake: what to do, who is named, why, the snapshot, and what changed. */
export const tickPrompt = ({
  request,
  people,
  reason,
  snapshot,
  diff,
}: {
  readonly request: string;
  readonly people: string;
  readonly reason: string;
  readonly snapshot: string;
  readonly diff: string;
}): string =>
  [
    request.trimEnd(),
    ...(people.trim() === '' ? [] : [people.trimEnd()]),
    `## Why you woke: ${reason}`,
    '## Snapshot now',
    snapshot,
    '## Diff from last snapshot',
    diff,
  ].join('\n');

const macroId = /macro\|[\w.+-]+@[\w.-]+/g;

/** Every Macro id a snapshot names, the owner first. */
export const mentionedIds = (text: string, owner: string): readonly string[] =>
  [...new Set(text.match(macroId) ?? [])].sort((a, b) =>
    a === owner ? -1 : b === owner ? 1 : 0
  );

export type Beat = {
  readonly now: () => Temporal.Instant;
  /** sha256 of a text, as hex. */
  readonly digest: (text: string) => string;
  /** Commits whatever changed, with this message, then pulls and pushes main. */
  readonly commit: (message: string) => Promise<unknown>;
  readonly collect: () => Promise<string>;
  readonly cursor: {
    readonly read: () => Promise<Cursor | undefined>;
    readonly write: (cursor: Cursor) => Promise<void>;
  };
  /** The snapshot the last change was seen in. */
  readonly last: {
    readonly read: () => Promise<string | undefined>;
    readonly write: (snapshot: string) => Promise<void>;
  };
  readonly prune: () => Promise<unknown>;
  /** Cards for the people the snapshot names, or empty. */
  readonly people: (snapshot: string) => Promise<string>;
  /** The tick's standing request. */
  readonly request: string;
  readonly wake: (prompt: string) => Promise<Woke>;
  readonly log: (entry: object) => Promise<void>;
};

export type Beaten =
  | { readonly kind: 'asleep' }
  | {
      readonly kind: 'woke';
      readonly reason: string;
      /** Resolves once the agent's run has ended and the tick is recorded. */
      readonly finished: Promise<Woke>;
    };

export const syncMessage = 'sync: changes made outside a run';

/** One tick. It returns as soon as the agent is woken; `finished` is the rest. */
export const beat = async (deps: Beat): Promise<Beaten> => {
  // Whatever a tick does first must not stop it: a failed commit or prune is logged and the tick goes on.
  const attempt = async (
    step: string,
    run: () => Promise<unknown>
  ): Promise<void> => {
    await run().catch((error: unknown) =>
      deps.log({ failed: step, error: String(error) })
    );
  };
  await attempt('sync commit', () => deps.commit(syncMessage));
  await attempt('prune', deps.prune);

  const started = deps.now();
  const snapshot = (await deps.collect()).trimEnd();
  const hash = snapshotHash(deps.digest, snapshot);
  const cursor = await deps.cursor.read();
  const reason = wakeReason({ hash, lastHash: cursor?.hash, snapshot });
  if (reason === undefined) {
    // Gone empty: remembered, so the same thing coming back is a change again.
    if (hash !== cursor?.hash) {
      await deps.last.write('');
      await deps.cursor.write({
        hash,
        ...(cursor?.lastRun === undefined ? {} : { lastRun: cursor.lastRun }),
      });
    }
    await deps.log({ woke: false });
    return { kind: 'asleep' };
  }

  const previous = (await deps.last.read())?.trimEnd() ?? '';
  await deps.last.write(`${snapshot}\n`);
  const prompt = tickPrompt({
    request: deps.request,
    people: await deps.people(snapshot).catch(() => ''),
    reason,
    snapshot,
    diff: snapshotDiff(previous, snapshot),
  });
  const finished = deps
    .wake(prompt)
    .catch((error: unknown): Woke => ({ kind: 'failed', error: String(error) }))
    .then(async (woke) => {
      // Recorded whether the run worked or not: a failed run isn't retried
      // every half hour on the same snapshot.
      await deps.cursor.write({ hash, lastRun: isoText(started) });
      await deps.log({
        woke: true,
        reason,
        result: woke.kind === 'done' ? 'ok' : 'failed',
        ...(woke.kind === 'failed' ? { error: woke.error } : {}),
      });
      return woke;
    });
  return { kind: 'woke', reason, finished };
};
