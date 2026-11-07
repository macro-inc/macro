import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pkg, root } from './build-wasm';
/** Isolated, checksum-pinned oracle; never shares the recorder's patched copy. */
export async function prepareUpstream() {
  const pin: { url: string; sha256: string } = JSON.parse(
    readFileSync(path.join(pkg, 'upstream.lock'), 'utf8')
  );
  const target = path.join(root, 'target/lexical-diff-upstream');
  const patch = readFileSync(
    path.join(pkg, 'diff/patches/cascade-count.patch')
  );
  const stamp = pin.sha256 + createHash('sha256').update(patch).digest('hex');
  const cache = path.join(target, '.diff-pin');
  if (existsSync(cache) && readFileSync(cache, 'utf8') === stamp) return target;
  const response = await fetch(pin.url);
  if (!response.ok)
    throw new Error(`Upstream download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== pin.sha256)
    throw new Error('Upstream checksum mismatch');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const tarball = path.join(root, 'target/lexical-diff-upstream.tar.gz');
  writeFileSync(tarball, archive);
  for (const [command, args] of [
    ['tar', ['-xzf', tarball, '--strip-components=1', '-C', target]],
    [
      'patch',
      [
        '--batch',
        '-d',
        target,
        '-p1',
        '-i',
        path.join(pkg, 'diff/patches/cascade-count.patch'),
      ],
    ],
  ] as const) {
    const result = spawnSync(command, [...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${command} failed`);
  }
  symlinkSync(
    path.join(pkg, 'node_modules'),
    path.join(target, 'node_modules'),
    'dir'
  );
  writeFileSync(cache, stamp);
  return target;
}
