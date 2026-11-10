import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/** Read the same fixture text from a compressed archive or a plain staging file. */
export function readFixtureText(file: string): string {
  const plain = file.endsWith('.gz') ? file.slice(0, -3) : file;
  const compressed = `${plain}.gz`;
  if (existsSync(plain) && existsSync(compressed))
    throw new Error(`Ambiguous fixture: ${file}`);
  return file.endsWith('.gz') || existsSync(compressed)
    ? gunzipSync(readFileSync(compressed)).toString('utf8')
    : readFileSync(plain, 'utf8');
}

/** Keep the large recorder index compressed without changing its JSON bytes. */
export function writeRecordedFile(file: string, content: string): void {
  if (path.basename(file) === 'index.json') {
    writeFileSync(`${file}.gz`, gzipSync(content, { level: 9 }));
    rmSync(file, { force: true });
  } else writeFileSync(file, content);
}

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
    ...(existsSync(path.join(directory, 'index.json')) ||
    existsSync(path.join(directory, 'index.json.gz'))
      ? ['index.json']
      : []),
    ...walk(path.join(directory, 'upstream')),
  ].sort();
}

/** Replace only recorder-owned paths; keep fuzz counterexamples and their identity. */
export function removeRecordedFiles(directory: string): void {
  rmSync(path.join(directory, 'upstream'), { recursive: true, force: true });
  rmSync(path.join(directory, 'index.json'), { force: true });
  rmSync(path.join(directory, 'index.json.gz'), { force: true });
}
