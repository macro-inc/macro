import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateFixtureNames } from './privacy';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(pkg, '../..');
const target = path.join(root, 'target/lexical-upstream');
const check = process.argv.includes('--check');
const filter = process.argv
  .find((arg) => arg.startsWith('--filter='))
  ?.slice(9);
const pin = JSON.parse(readFileSync(path.join(pkg, 'upstream.lock'), 'utf8'));
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): number {
  const child = spawnSync(command, args, { cwd: pkg, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  return child.status ?? 1;
}
const stamp = hash(readFileSync(path.join(pkg, 'record/hooks.patch')));
if (
  !existsSync(path.join(target, '.recorder-pin')) ||
  readFileSync(path.join(target, '.recorder-pin'), 'utf8') !==
    pin.sha256 + stamp
) {
  const response = await fetch(pin.url);
  if (!response.ok)
    throw new Error(`Upstream download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (hash(archive) !== pin.sha256)
    throw new Error('Upstream checksum mismatch');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const tarball = path.join(root, 'target/lexical-upstream.tar.gz');
  writeFileSync(tarball, archive);
  if (run('tar', ['-xzf', tarball, '--strip-components=1', '-C', target]))
    throw new Error('Extract failed');
  if (
    run('patch', [
      '--batch',
      '-d',
      target,
      '-p1',
      '-i',
      path.join(pkg, 'record/hooks.patch'),
    ])
  )
    throw new Error('Patch failed');
  symlinkSync(
    path.join(pkg, 'node_modules'),
    path.join(target, 'node_modules'),
    'dir'
  );
  writeFileSync(path.join(target, '.recorder-pin'), pin.sha256 + stamp);
}
const staging = path.join(root, 'target/lexical-recording');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const vitest = path.join(pkg, 'node_modules/vitest/vitest.mjs');
const revision = hash(
  readdirSync(path.join(pkg, 'record'))
    .filter((file) => /\.(ts|mts|json|patch)$/.test(file))
    .sort()
    .map((file) => readFileSync(path.join(pkg, 'record', file), 'utf8'))
    .join('\n')
);
const results: Record<string, Map<string, Case>> = {};
type Case = {
  id: string;
  state: string;
  assertions: number;
  s2Hits: string[];
  transformersFired: string[];
  lines: Record<string, number[]>;
  calls: number;
  reasons: string[];
  fixture: Record<string, unknown>;
};
for (const [lane, oracle, membrane] of [
  ['dev', 'development', 'on'],
  ['prod', 'production', 'on'],
  ['plain', 'development', 'off'],
]) {
  const output = path.join(staging, lane);
  const env = {
    ...process.env,
    LEXICAL_UPSTREAM: target,
    LEXICAL_RECORDER_REV: revision,
    LEXICAL_RECORD_OUTPUT: output,
    LEXICAL_ORACLE: oracle,
    LEXICAL_MEMBRANE: membrane,
  };
  const args = [
    vitest,
    'run',
    '--config',
    path.join(pkg, 'record/vitest.record.mts'),
  ];
  if (filter) args.push(filter);
  const status = run('node', args, env);
  // A failed upstream test is classified, never accepted as an oracle.
  if (!existsSync(path.join(output, 'cases')))
    throw new Error(`No cases in ${lane} (exit ${status})`);
  results[lane] = new Map(
    readdirSync(path.join(output, 'cases')).map((file) => {
      const item: Case = JSON.parse(
        readFileSync(path.join(output, 'cases', file), 'utf8')
      );
      return [item.id, item];
    })
  );
}
const files = new Map<string, string>();
const index: Record<string, unknown>[] = [];
function apiCalls(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(apiCalls);
  const object = value as Record<string, unknown>;
  const own =
    object.op === 'call' && typeof object.fn === 'string' ? [object.fn] : [];
  return [...own, ...Object.values(object).flatMap(apiCalls)];
}
for (const [id, dev] of [...results.dev].sort(([a], [b]) =>
  a.localeCompare(b)
)) {
  const prod = results.prod.get(id);
  const plain = results.plain.get(id);
  const reasons = [...dev.reasons];
  if (dev.state !== 'passed') reasons.push('upstream-failed');
  if (
    !plain ||
    plain.state !== dev.state ||
    plain.assertions !== dev.assertions
  )
    reasons.push('membrane-not-transparent');
  if (!prod) reasons.push('production-missing');
  else {
    reasons.push(...prod.reasons);
    if (prod.state !== 'passed') reasons.push('upstream-production-failed');
  }
  if (!dev.calls) reasons.push('no-model-calls');
  const tier = reasons.some((r) => r.startsWith('view:'))
    ? 'view'
    : reasons.some((r) => r.startsWith('A-hand:'))
      ? 'A-hand'
      : reasons.length
        ? 'B-only'
        : 'A-rec';
  const filename = `upstream/${id.split('/')[0]}/${hash(id).slice(0, 16)}.json`;
  if (tier === 'A-rec' && prod) {
    const fixture = prod.fixture;
    if (
      JSON.stringify(dev.fixture.trace) !== JSON.stringify(prod.fixture.trace)
    ) {
      const development = dev.fixture.trace as Record<string, unknown>[];
      const production = prod.fixture.trace as Record<string, unknown>[];
      fixture.outcomeDiffers = development.flatMap((op, index) =>
        JSON.stringify(op) === JSON.stringify(production[index])
          ? []
          : [
              {
                op: index,
                call: op.fn ?? op.op,
                outcomeDev: op,
                outcomeProd: production[index] ?? null,
              },
            ]
      );
      fixture.normalize = ['devOutcome'];
    }
    files.set(filename, JSON.stringify(fixture, null, 2) + '\n');
  }
  index.push({
    id,
    tier,
    reasons: [...new Set(reasons)],
    file: tier === 'A-rec' ? filename : null,
    calls: apiCalls(dev.fixture.trace).length,
    apis: [...new Set(apiCalls([dev.fixture.trace, dev.fixture.tapes]))].sort(),
    assertions: dev.assertions,
    s2Hits: dev.s2Hits,
    transformersFired: dev.transformersFired,
  });
}
for (const name of privateFixtureNames(files)) {
  files.delete(name);
  const row = index.find((entry) => entry.file === name);
  if (!row) throw new Error('Privacy scan returned an unknown fixture');
  row.file = null;
  row.tier = 'B-only';
  (row.reasons as string[]).push('repository-privacy-filter');
}
if (!index.some((row) => row.tier === 'A-rec'))
  throw new Error('No replayable fixtures were recorded');
files.set('index.json', JSON.stringify(index, null, 2) + '\n');
const replayDirectory = path.join(staging, 'fixtures');
for (const [name, content] of files) {
  mkdirSync(path.dirname(path.join(replayDirectory, name)), {
    recursive: true,
  });
  writeFileSync(path.join(replayDirectory, name), content);
}
if (
  run('node', [vitest, 'run', '--config', 'record/vitest.config.ts'], {
    ...process.env,
    LEXICAL_REPLAY_ONLY: '1',
    LEXICAL_FIXTURES: replayDirectory,
    LEXICAL_UPSTREAM: target,
  })
)
  throw new Error('Serialized fixture replay failed');
const fixtures = path.join(pkg, 'fixtures');
if (check) {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : [path.relative(fixtures, path.join(dir, entry.name))]
        )
      : [];
  if (walk(fixtures).sort().join('\n') !== [...files.keys()].sort().join('\n'))
    throw new Error('Fixture file set drift');
  for (const [name, content] of files) {
    if (readFileSync(path.join(fixtures, name), 'utf8') !== content)
      throw new Error(`Fixture drift: ${name}`);
  }
} else {
  rmSync(fixtures, { recursive: true, force: true });
  for (const [name, content] of files) {
    mkdirSync(path.dirname(path.join(fixtures, name)), { recursive: true });
    writeFileSync(path.join(fixtures, name), content);
  }
}
const recorded = index.filter((row) => row.tier === 'A-rec').length;
if (!recorded) throw new Error('No replayable fixtures were recorded');
console.log(
  `${recorded}/${index.length} fixtures recorded, replayed, and transparency checked${check ? '; no diff' : ''}`
);
if (
  run('node', [vitest, 'run', '--config', 'record/vitest.config.ts'], {
    ...process.env,
    LEXICAL_UPSTREAM: target,
    LEXICAL_RECORDER_REV: revision,
  })
)
  process.exitCode = 1;
