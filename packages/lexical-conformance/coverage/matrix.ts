import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  directory,
  files,
  hash,
  index,
  inputs,
  type ReplayEvidence,
  root,
} from './evidence';
import { rustCode, testOnlyRanges } from './rust-scopes';
import { HEADER } from './seed-markdown';
import { transformerReferences } from './transformers';

export type Seed = Record<(typeof HEADER)[number], string>;
export function seeds(text: string): Seed[] {
  const [header, ...lines] = text
    .trimEnd()
    .split('\n')
    .map((line) => line.split('\t'));
  if (header.join('\t') !== HEADER.join('\t'))
    throw new Error('Invalid seed columns');
  return lines.map(
    (cells) =>
      Object.fromEntries(
        header.map((name, i) => [name, cells[i] ?? ''])
      ) as Seed
  );
}
export type Tag = {
  file: string;
  line: number;
  ignored: boolean;
  test: string;
};
export function tags(
  file: string,
  text: string,
  marker: 'covers' | 's2'
): [string, Tag][] {
  const excluded = marker === 's2' ? testOnlyRanges(text) : [];
  const code = marker === 's2' ? rustCode(text) : '';
  const lines = text.split('\n');
  let position = 0;
  return lines.flatMap((line, offset) => {
    const start = position;
    position += line.length + 1;
    if (excluded.some(([from, to]) => start >= from && start < to)) return [];
    const match = line.match(
      new RegExp(`^\\s*(?:///|//|\\*)\\s*${marker}:\\s*(.+)$`)
    );
    if (!match) return [];
    const next = lines.slice(offset + 1, offset + 18).join('\n');
    if (marker === 's2') {
      if (!file.endsWith('.rs') || /(?:^|\/)tests?(?:\/|\.rs$)/.test(file))
        return [];
      const followingCode = code.slice(position, position + next.length);
      const item = followingCode.match(
        /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:unsafe|async|default|const|extern)\s+)*(?:fn|struct|enum|trait|impl|const|type)\b/m
      );
      if (
        !item ||
        /#\[\s*test\b/.test(followingCode.slice(0, item.index)) ||
        excluded.some(
          ([from, to]) =>
            position + (item.index ?? 0) >= from &&
            position + (item.index ?? 0) < to
        )
      )
        return [];
    }
    const test = next.match(
      /\bfn\s+(\w+)|\b(?:it|test)(?:\.\w+)*\s*\(\s*['"`]([^'"`]+)/
    );
    const prefix = next.slice(0, test?.index ?? next.length);
    return match[1].split(',').map(
      (id) =>
        [
          id.trim(),
          {
            file,
            line: offset + 1,
            ignored: /#\[ignore|\.(skip|todo)\s*\(/.test(
              prefix + (test?.[0] ?? '')
            ),
            test: test?.[1] ?? test?.[2] ?? '',
          },
        ] as [string, Tag]
    );
  });
}
function sources(): string[] {
  const client = path.join(root, 'crates/client');
  return [
    ...files(path.join(client, 'lexical')),
    ...files(path.join(client, 'doc_sync_core')),
    ...files(client).filter((file) =>
      path.relative(client, file).startsWith('document_session')
    ),
    ...[
      'crates/sync_protocol',
      'tooling/sync-sim',
      'packages/lexical-conformance',
      'packages/lexical-wasm-shim',
      'packages/collaboration/src/session',
      'apps/web/e2e',
      'apps/web/tests',
    ].flatMap((name) => files(path.join(root, name))),
  ].filter((file) => /\.(rs|tsx?|jsx?)$/.test(file));
}
export function build(seed: Seed[]) {
  const covers = new Map<string, Tag[]>();
  const owners = new Map<string, Tag[]>();
  for (const file of [...new Set(sources())].sort()) {
    const relative = path.relative(root, file);
    const text = readFileSync(file, 'utf8');
    for (const [marker, output] of [
      ['covers', covers],
      ['s2', owners],
    ] as const)
      for (const [id, tag] of tags(relative, text, marker)) {
        if (
          marker === 's2' &&
          (!relative.endsWith('.rs') ||
            /(?:^|\/)tests?(?:\/|\.rs$)/.test(relative))
        )
          continue;
        output.set(id, [...(output.get(id) ?? []), tag]);
      }
  }
  const corpus = index().filter((row) => row.file);
  return seed.map((row) => {
    const symbol = row.kind === 'sym' ? row.id.slice(3) : '';
    const split = symbol.lastIndexOf(':');
    const api =
      split >= 0 ? symbol.slice(0, split) + '.' + symbol.slice(split + 1) : '';
    const transformers = row.id.startsWith('S3:tf:')
      ? transformerReferences(row)
      : [];
    const fixtures = corpus
      .filter((fixture) =>
        row.tier === 'A-rec|A-hand'
          ? fixture.apis.includes(api)
          : row.tier === 'A-rec(fired)|A-hand'
            ? transformers.some((name) =>
                fixture.transformersFired.includes(name)
              )
            : false
      )
      .map((fixture) => ({ id: fixture.id, file: fixture.file as string }));
    const observedFixtures = corpus
      .filter((fixture) => fixture.s2Hits.includes(row.id))
      .map((fixture) => fixture.file);
    return {
      ...row,
      fixtures,
      observedFixtures,
      tests: covers.get(row.id) ?? [],
      owners: owners.get(row.id) ?? [],
    };
  });
}
export type MatrixRow = ReturnType<typeof build>[number];
type TestEvidence = {
  file: string;
  line: number;
  test: string;
  sourceHash: string;
  passed: boolean;
  tier?: string;
  rustExecuted?: Record<string, number>;
};
export function testEvidence(): TestEvidence[] {
  const file = path.join(directory, 'results/tests.json');
  if (!existsSync(file)) return [];
  const evidence: { inputs: string; tests: TestEvidence[] } = JSON.parse(
    readFileSync(file, 'utf8')
  );
  if (evidence.inputs !== inputs())
    throw new Error(
      'Stale handwritten test evidence: rerun coverage/run-tests.ts'
    );
  return evidence.tests;
}
export function covered(
  row: MatrixRow,
  replay: ReplayEvidence | undefined,
  tests: TestEvidence[]
): boolean {
  if (row.gate !== 'required') return false;
  const needsOwner =
    row.kind === 'beh' &&
    /MODEL|BRIDGE/.test(row.class) &&
    row.owner.startsWith('rust:');
  if (
    needsOwner &&
    !row.owners.some((owner) => implementationOwner(row.owner, owner.file))
  )
    return false;
  if (
    row.fixtures.some(
      (fixture) => replay?.cases[fixture.file]?.status === 'pass'
    )
  )
    return true;
  return row.test_id
    .split(' + ')
    .every((primary) =>
      row.tests.some(
        (tag) =>
          !tag.ignored &&
          (!row.test_file || tag.file === row.test_file) &&
          tests.some(
            (result) =>
              primaryTest({ ...row, test_id: primary }, tag.test) &&
              result.passed === true &&
              result.file === tag.file &&
              result.line === tag.line &&
              result.test === tag.test &&
              result.sourceHash ===
                hash(readFileSync(path.join(root, tag.file))) &&
              (result.tier !== 'B' ||
                !row.owner.startsWith('rust:') ||
                (result.rustExecuted?.[row.id] ?? 0) > 0)
          )
      )
    );
}
export const ledgerReasons = new Set([
  'view-only',
  'not-ported',
  'js-by-design',
  'dropped-route',
  'removed',
]);
export function ledgerReason(row: Seed): string | undefined {
  return row.gate.match(/^ledger:([^()]+)/)?.[1];
}

/** A covers tag is secondary evidence until the seed's named primary actually ran. */
export function primaryTest(row: Seed, name: string): boolean {
  if (row.test_id.includes(' + ')) return false;
  return row.test_id.split(' | ').some((primary) => {
    if (primary.startsWith('index:') || primary.startsWith('fired:'))
      return false;
    const leaf = primary.split('::').at(-1)?.replaceAll('-', '_').toLowerCase();
    return Boolean(
      leaf &&
        !/[ *()]/.test(leaf) &&
        (name.toLowerCase() === leaf ||
          name.toLowerCase().startsWith(leaf + '_'))
    );
  });
}

const crateNames = new Map<string, string>();
function implementationOwner(owner: string, file: string): boolean {
  if (!file.endsWith('.rs') || !file.includes('/src/')) return false;
  const manifest = path.join(
    root,
    file.slice(0, file.indexOf('/src/')),
    'Cargo.toml'
  );
  if (!crateNames.has(manifest)) {
    const name = existsSync(manifest)
      ? (readFileSync(manifest, 'utf8').match(/^name\s*=\s*"([^"]+)"/m)?.[1] ??
        '')
      : '';
    crateNames.set(manifest, name);
  }
  return crateNames.get(manifest) === owner.slice(5).split('+')[0];
}
