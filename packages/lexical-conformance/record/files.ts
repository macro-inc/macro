import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Recorder ownership excludes independently generated differential artifacts. */
export function recordedFiles(directory: string): string[] {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : [path.relative(directory, path.join(dir, entry.name))]
        )
      : [];
  return [
    ...(existsSync(path.join(directory, 'index.json')) ? ['index.json'] : []),
    ...walk(path.join(directory, 'upstream')),
  ].sort();
}

/** Replace only recorder-owned paths; keep fuzz counterexamples and their identity. */
export function removeRecordedFiles(directory: string): void {
  rmSync(path.join(directory, 'upstream'), { recursive: true, force: true });
  rmSync(path.join(directory, 'index.json'), { force: true });
}
