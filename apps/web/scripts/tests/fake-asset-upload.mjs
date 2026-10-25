#!/usr/bin/env bun
// Local-only stand-in for the S3 cp commands exercised by publishing tests.
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const [service, operation, source, destination, ...options] =
  process.argv.slice(2);
if (service !== 's3' || operation !== 'cp') process.exit(64);
const target = new URL(destination);
if (target.hostname !== 'example') process.exit(64);
const cacheControl = options[options.indexOf('--cache-control') + 1];
const recursive = options.includes('--recursive');
if (
  process.env.FAIL_ASSETS === 'true' &&
  recursive &&
  cacheControl.includes('immutable')
) {
  process.exit(42);
}
const filters = [];
for (let index = 0; index < options.length; index += 1) {
  if (options[index] !== '--include' && options[index] !== '--exclude')
    continue;
  filters.push({
    include: options[index] === '--include',
    pattern: options[++index],
  });
}
const files = recursive
  ? readdirSync(source, { recursive: true }).filter((file) =>
      statSync(join(source, file)).isFile()
    )
  : [basename(source)];
for (const file of files) {
  let included = true;
  for (const filter of filters) {
    const glob = new Bun.Glob(`**/${filter.pattern}`);
    if (glob.match(file)) included = filter.include;
  }
  if (!included) continue;
  const key = recursive
    ? join(target.pathname.slice(1), file)
    : target.pathname.slice(1);
  const path = join(process.env.FAKE_S3_ROOT, key);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(recursive ? join(source, file) : source, path);
  appendFileSync(
    process.env.FAKE_AWS_LOG,
    JSON.stringify({ key, cacheControl, options }) + '\n'
  );
}
