import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import manifest from './agent-ui-sources.json';

// Git objects work with sparse checkouts. This compares source, not deployment
// availability or rendered pixels, and never fetches or updates the baseline.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const ref = process.argv[2] ?? 'origin/main';
let drift = false;
for (const source of manifest.sources) {
  try {
    const blob = execFileSync(
      'git',
      ['rev-parse', '--verify', `${ref}:${source.path}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    if (blob === source.blob) continue;
    drift = true;
    console.error(
      `Changed app source: ${source.path}\n  Review: ${source.consumer}`
    );
  } catch {
    drift = true;
    console.error(
      `Cannot inspect ${ref}:${source.path}. Fetch the reference and rerun the check.`
    );
  }
}
if (drift) {
  console.error(
    `Agent demo review needed; baseline ${manifest.commit}. Do not refresh hashes without reviewing the UI.`
  );
  process.exitCode = 1;
} else {
  console.log(
    `Agent UI source check passed against ${ref} (${manifest.sources.length} files). Rendered and deployed parity still need browser review.`
  );
}
