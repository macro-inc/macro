import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Everything the observability image is built from. The flake reads only
// these; `image-key.test.ts` checks no Nix file reaches outside them.
export const IMAGE_INPUTS = ['flake.nix', 'flake.lock', 'nixos', 'assets'];
// A separate image from the same flake; the observability host never imports it.
const EXCLUDED = ['nixos/database-collector/'];

// AMIs carry one tag key per source key they were built or verified for.
export const SOURCE_TAG_PREFIX = 'ImageSource:';

export function imageFiles(stackDir: string): string[] {
  // Git-tracked files only, like the flake itself sees them.
  return execFileSync('git', ['ls-files', '-z', '--', ...IMAGE_INPUTS], {
    cwd: stackDir,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(
      (path) => path && !EXCLUDED.some((prefix) => path.startsWith(prefix))
    )
    .sort();
}

/** A hash of the image's source, so Pulumi and CI agree on its AMI without a commit. */
export function imageSourceKey(stackDir: string): string {
  const hash = createHash('sha256');
  for (const path of imageFiles(stackDir)) {
    hash.update(path).update('\0');
    hash.update(readFileSync(join(stackDir, path))).update('\0');
  }
  return hash.digest('hex');
}
