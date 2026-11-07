import { spawnSync } from 'node:child_process';
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
