import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Apply the repository's privacy policy without changing oracle values or exceptions. */
export function privateFixtureNames(files: Map<string, string>): string[] {
  const scanner = fileURLToPath(
    new URL('../../../tooling/pii/scan.py', import.meta.url)
  );
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent))
from scan import load_exceptions, scan_line
exceptions = load_exceptions()
files = json.load(sys.stdin)
print(json.dumps([name for name, content in files.items()
    if any(scan_line(name, n, line, exceptions)
           for n, line in enumerate(content.splitlines(), 1))]))
`,
      scanner,
    ],
    {
      input: JSON.stringify(Object.fromEntries(files)),
      encoding: 'utf8',
    }
  );
  if (result.error || result.status !== 0)
    throw new Error('Repository privacy scan failed');
  return JSON.parse(result.stdout);
}

/** Retain one opaque index row for each excluded test, including private test titles. */
export function excludePrivateFixtures(
  files: Map<string, string>,
  index: Record<string, unknown>[]
): void {
  for (const name of privateFixtureNames(files)) {
    files.delete(name);
    const row = index.find((entry) => entry.file === name);
    if (!row) throw new Error('Privacy scan returned an unknown fixture');
    row.file = null;
    row.tier = 'B-only';
    (row.reasons as string[]).push('repository-privacy-filter');
  }
  const rows = new Map(index.map((row, n) => [String(n), JSON.stringify(row)]));
  for (const name of privateFixtureNames(rows)) {
    const row = index[Number(name)];
    const original = String(row.id);
    const digest = createHash('sha256')
      .update(original)
      .digest('hex')
      .slice(0, 16);
    if (typeof row.file === 'string') files.delete(row.file);
    row.id = `${original.split('::')[0]}::<privacy-filtered:${digest}>`;
    row.file = null;
    row.tier = 'B-only';
    row.reasons = ['repository-privacy-filter'];
  }
}
