/**
 * Compares what the two builds did with the same sequences.
 *
 *   bun tests/channels-e2e/fuzz/compare.ts <run directory> [<run directory of the other build>]
 *
 * Reads `fuzz/off/*.json` and `fuzz/on/*.json` under the directories, prints
 * a summary and writes `fuzz/report.json` beside them. Every difference is
 * put in one of three classes:
 *
 * - `intended`: the builds ended differently and each ended as its model
 *   says: writes made while requests failed or their answers were lost,
 *   which the models say the two builds treat differently.
 * - `on only` / `off only`: one build disagreed with its model, with the
 *   services or between its windows, and the other did not.
 * - `both`: both builds did, at the same operation: not a difference
 *   between them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Side } from './model';
import { blocks, type Finding, type Result, sameBlocks } from './run';
import { shapeOf } from './shape';

type Entry = {
  id: string;
  seed: number;
  profile: string;
  /** How the builds' end states relate. */
  end: 'same' | 'intended' | 'unexplained' | 'one build missing';
  /** Writes one build delivered and the other lost, as the models expect. */
  intended: string[];
  findings: {
    side: Side | 'both';
    kind: string;
    /** What the two sides of the finding differ in. */
    shape: string;
    step: number;
    detail: string;
  }[];
};

function load(directories: string[], side: Side): Map<string, Result> {
  const out = new Map<string, Result>();
  for (const directory of directories) {
    const folder = join(directory, 'fuzz', side);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.json')) continue;
      const result = JSON.parse(
        readFileSync(join(folder, name), 'utf8')
      ) as Result;
      out.set(result.id, result);
    }
  }
  return out;
}

/** Sequences that stopped before their end and so left no result. */
function abortedIn(directories: string[], side: Side): string[] {
  return directories.flatMap((directory) => {
    const folder = join(directory, 'fuzz', side);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json.failed'))
      .filter((name) => !existsSync(join(folder, name.slice(0, -7))))
      .map((name) => `${name.slice(0, -12)} (${side})`);
  });
}
/**
 * Whether the services hold the messages in an order the sequence allows:
 * a message the services got at a later operation comes later, and one
 * person's messages delivered together keep the order they were written in.
 */
function orderFindings(result: Result): Finding[] {
  const token = new RegExp(`q${result.seed}([mp])(\\d+) v`);
  const out: Finding[] = [];
  const check = (lines: string[], where: string) => {
    let last: { key: string; group: number; n: number } | undefined;
    for (const line of lines) {
      const found = token.exec(line);
      if (!found) continue;
      const key = `${found[1]}${found[2]}`;
      const group = result.end.groups[key];
      if (group === undefined) continue;
      const now = { key, group, n: Number(found[2]) };
      const sameAuthor =
        last && result.end.authors[last.key] === result.end.authors[key];
      if (
        last &&
        (now.group < last.group ||
          (now.group === last.group && sameAuthor && now.n < last.n))
      ) {
        out.push({
          kind: 'messages held in the wrong order',
          step: -1,
          detail: `${where}: ${last.key} (operation ${last.group}) is before ${key} (operation ${group})`,
        });
      }
      last = now;
    }
  };
  check(
    result.end.server.filter((line) => !line.startsWith('  > ')),
    'channel'
  );
  let thread: string[] = [];
  for (const line of [...result.end.server, '']) {
    if (line.startsWith('  > ')) thread.push(line);
    else {
      if (thread.length > 1) check(thread, 'thread');
      thread = [];
    }
  }
  return out;
}

function compareOne(off?: Result, on?: Result): Entry {
  const any = (off ?? on) as Result;
  const entry: Entry = {
    id: any.id,
    seed: any.seed,
    profile: any.profile,
    end: 'one build missing',
    intended: [],
    findings: [],
  };
  const all = (result: Result | undefined) =>
    result ? [...result.findings, ...orderFindings(result)] : [];
  const [offFindings, onFindings] = [all(off), all(on)];
  // The same thing found in both builds, in this sequence, is not a
  // difference between them.
  const same = (a: Finding, b: Finding) =>
    a.kind === b.kind && shapeOf(a) === shapeOf(b);
  for (const finding of onFindings) {
    const both = offFindings.some((other) => same(other, finding));
    entry.findings.push({
      side: both ? 'both' : 'on',
      shape: shapeOf(finding),
      ...finding,
    });
  }
  for (const finding of offFindings) {
    if (!onFindings.some((other) => same(other, finding))) {
      entry.findings.push({ side: 'off', shape: shapeOf(finding), ...finding });
    }
  }
  if (!off || !on) return entry;

  if (sameBlocks(off.end.server, on.end.server)) {
    entry.end = 'same';
  } else if (
    sameBlocks(off.end.server, off.end.model) &&
    sameBlocks(on.end.server, on.end.model)
  ) {
    entry.end = 'intended';
  } else {
    entry.end = 'unexplained';
  }
  // The writes whose fate the models say differs between the builds.
  on.steps.forEach((step, index) => {
    step.acts.forEach((act, part) => {
      const other = off.steps[index]?.acts[part];
      if (other && other.outcome !== act.outcome) {
        entry.intended.push(
          `operation ${index}: ${act.what} — on: ${act.outcome}, off: ${other.outcome}`
        );
      }
    });
  });
  // With the same messages held, the windows should show the same too.
  if (entry.end === 'same') {
    for (const win of Object.keys(on.end.windows)) {
      for (const when of ['settled', 'reloaded'] as const) {
        const [a, b] = [off.end.windows[win][when], on.end.windows[win][when]];
        if (blocks(a).join('\n') !== blocks(b).join('\n')) {
          entry.findings.push({
            side: 'both',
            shape: '',
            kind: 'windows of the two builds differ with the same messages held',
            step: -1,
            detail: `${win}, ${when}`,
          });
        }
      }
    }
  }
  return entry;
}

function main(): void {
  const directories = process.argv.slice(2);
  if (directories.length === 0) {
    throw new Error('usage: compare.ts <run directory> [<run directory>]');
  }
  const off = load(directories, 'off');
  const on = load(directories, 'on');
  const ids = [...new Set([...off.keys(), ...on.keys()])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  for (const id of ids) {
    const [a, b] = [off.get(id), on.get(id)];
    if (a && b && JSON.stringify(a.ops) !== JSON.stringify(b.ops)) {
      throw new Error(
        `${id} is not the same sequence on the two builds: run both with the same seeds and length`
      );
    }
  }
  const aborted = [
    ...abortedIn(directories, 'off'),
    ...abortedIn(directories, 'on'),
  ];
  const entries = ids.map((id) => compareOne(off.get(id), on.get(id)));
  const total = (results: Map<string, Result>) => ({
    sequences: results.size,
    operations: [...results.values()].reduce(
      (sum, result) => sum + result.operations,
      0
    ),
    bundles: [...new Set([...results.values()].map((result) => result.bundle))],
    minutes: Math.round(
      [...results.values()].reduce((sum, result) => sum + result.ms, 0) / 60_000
    ),
  });
  const kinds: Record<string, Record<string, string[]>> = {};
  for (const entry of entries) {
    for (const finding of entry.findings) {
      const name = finding.shape
        ? `${finding.kind}: ${finding.shape}`
        : finding.kind;
      kinds[name] ??= {};
      kinds[name][finding.side] ??= [];
      if (!kinds[name][finding.side].includes(entry.id)) {
        kinds[name][finding.side].push(entry.id);
      }
    }
  }
  const report = {
    off: total(off),
    on: total(on),
    ends: Object.fromEntries(
      (['same', 'intended', 'unexplained', 'one build missing'] as const).map(
        (end) => [
          end,
          entries.filter((entry) => entry.end === end).map((entry) => entry.id),
        ]
      )
    ),
    kinds,
    entries,
  };
  const out = join(directories[0], 'fuzz', 'report.json');
  writeFileSync(out, JSON.stringify(report, null, 1));

  console.log(
    `off: ${report.off.sequences} sequences, ${report.off.operations} operations, bundle ${report.off.bundles.join('/')}`
  );
  console.log(
    `on:  ${report.on.sequences} sequences, ${report.on.operations} operations, bundle ${report.on.bundles.join('/')}`
  );
  if (aborted.length > 0) {
    console.log(`stopped before the end, not compared: ${aborted.join(', ')}`);
  }
  if (report.off.bundles.some((bundle) => report.on.bundles.includes(bundle))) {
    console.log('WARNING: both sides ran the same bundle');
  }
  for (const [end, list] of Object.entries(report.ends)) {
    console.log(
      `end states ${end}: ${list.length}${list.length && end !== 'same' ? ` (${list.join(', ')})` : ''}`
    );
  }
  for (const [kind, sides] of Object.entries(kinds)) {
    console.log(`\n${kind}`);
    for (const [side, list] of Object.entries(sides)) {
      console.log(`  ${side}: ${list.length} sequences (${list.join(', ')})`);
    }
  }
  console.log(`\nwritten to ${out}`);
}

main();
