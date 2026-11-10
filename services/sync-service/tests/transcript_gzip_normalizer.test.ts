import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, vi } from 'vitest';
import { compare } from '../scripts/normalize-transcripts.mjs';

const literal = '{"out":"send","frame_b64":"AAEC"}\n';

test('compressed and plain directories retain every logical transcript and frame byte', () => {
  const root = mkdtempSync(join(tmpdir(), 'transcript-gzip-'));
  try {
    for (const name of ['plain', 'compressed']) mkdirSync(join(root, name, 'suite'), {recursive: true});
    writeFileSync(join(root, 'plain/suite/case.jsonl'), literal);
    writeFileSync(join(root, 'compressed/suite/case.jsonl.gz'), gzipSync(literal));
    expect(compare(join(root, 'plain'), join(root, 'compressed'))).toEqual([]);
    writeFileSync(join(root, 'compressed/suite/case.jsonl.gz'), gzipSync(literal.replace('AAEC', 'AQEC')));
    expect(compare(join(root, 'plain'), join(root, 'compressed'))).toHaveLength(1);
    writeFileSync(join(root, 'compressed/suite/extra.jsonl.gz'), gzipSync(literal));
    expect(compare(join(root, 'plain'), join(root, 'compressed'))).toHaveLength(2);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('duplicate logical recordings and damaged gzip fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'transcript-gzip-'));
  try {
    writeFileSync(join(root, 'case.jsonl'), literal);
    writeFileSync(join(root, 'case.jsonl.gz'), gzipSync(literal));
    expect(() => compare(root, root)).toThrow('ambiguous transcript');
    rmSync(join(root, 'case.jsonl'));
    writeFileSync(join(root, 'case.jsonl.gz'), 'invalid gzip');
    expect(() => compare(root, root)).toThrow();
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('git corpus reads gzip blobs with the same logical name and exact wire differences', () => {
  const root = mkdtempSync(join(tmpdir(), 'transcript-gzip-git-'));
  try {
    const corpus = join(root, 'crates/sync_server_sim/tests/transcripts/suite');
    const actual = join(root, 'actual/suite');
    const activated = join(root, 'crates/sync_server_sim/tests/transcripts-activated/suite');
    mkdirSync(corpus, {recursive: true});
    mkdirSync(actual, {recursive: true});
    mkdirSync(activated, {recursive: true});
    writeFileSync(join(corpus, 'case.jsonl.gz'), gzipSync(literal));
    writeFileSync(join(activated, 'case.jsonl.gz'), gzipSync(literal));
    writeFileSync(join(actual, 'case.jsonl'), literal);
    execFileSync('git', ['init', '--quiet'], {cwd: root});
    execFileSync('git', ['add', 'crates'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'test(fixtures): seed compressed transcript'], {cwd: root});
    vi.stubEnv('GIT_DIR', join(root, '.git'));
    const run = () => compare('git:HEAD', join(root, 'actual'));
    expect(run()).toEqual([]);
    expect(compare('git-activated:HEAD', join(root, 'actual'))).toEqual([]);
    writeFileSync(join(actual, 'case.jsonl'), literal.replace('AAEC', 'AQEC'));
    expect(run()).toHaveLength(1);
    expect(compare('git-activated:HEAD', join(root, 'actual'))).toHaveLength(1);
    writeFileSync(join(corpus, 'case.jsonl'), literal);
    execFileSync('git', ['add', 'crates'], {cwd: root});
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--quiet', '-m', 'test(fixtures): retain ambiguous physical forms'], {cwd: root});
    expect(run).toThrow('ambiguous transcript');
  } finally { vi.unstubAllEnvs(); rmSync(root, {recursive: true, force: true}); }
});
