// Line coverage of the app's source from the script bytes that ran in the
// browser (`record.ts`) and the source maps of the bundle.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The segments of a source map's `mappings` that point at a source: the
 * column in each generated line, the source and the line in it.
 */
export function segments(
  mappings: string
): { line: number; column: number; source: number; sourceLine: number }[] {
  const found: ReturnType<typeof segments> = [];
  let line = 0;
  let column = 0;
  let source = 0;
  let sourceLine = 0;
  let field = 0;
  let value = 0;
  let shift = 0;
  let fields: number[] = [];
  const end = () => {
    if (fields.length >= 4) {
      column += fields[0];
      source += fields[1];
      sourceLine += fields[2];
      found.push({ line, column, source, sourceLine });
    } else if (fields.length > 0) column += fields[0];
    fields = [];
    field = 0;
  };
  for (const char of mappings) {
    if (char === ',' || char === ';') {
      end();
      if (char === ';') {
        line += 1;
        column = 0;
      }
      continue;
    }
    const digit = BASE64.indexOf(char);
    value += (digit & 31) << shift;
    shift += 5;
    if ((digit & 32) === 0) {
      fields[field++] = value & 1 ? -(value >> 1) : value >> 1;
      value = 0;
      shift = 0;
    }
  }
  end();
  return found;
}

/** The scripts' bytes that ran, each worker's file joined: by URL path. */
export function loadRan(dir: string): Map<string, Uint8Array> {
  const ran = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return ran;
  for (const name of readdirSync(dir)) {
    const worker = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as Record<
      string,
      string
    >;
    for (const [path, packed] of Object.entries(worker)) {
      const bytes = new Uint8Array(gunzipSync(Buffer.from(packed, 'base64')));
      const all = ran.get(path);
      if (!all || all.length !== bytes.length) {
        ran.set(path, bytes);
        continue;
      }
      for (let i = 0; i < all.length; i++) all[i] |= bytes[i];
    }
  }
  return ran;
}

export type FileLines = {
  /** Lines the bundle has code for. */
  lines: number;
  /** Of those, the lines that ran. */
  covered: number;
  /** Whether a test loaded a script that holds the file. */
  loaded: boolean;
};

/**
 * The lines of each source file the bundle holds and which of them ran.
 * `wanted` picks the files, by their path from the repository.
 */
export function lineCoverage(
  dist: string,
  repository: string,
  ran: Map<string, Uint8Array>,
  wanted: (file: string) => boolean
): Map<string, FileLines> {
  const byFile = new Map<
    string,
    { lines: Set<number>; covered: Set<number>; loaded: boolean }
  >();
  const ranByName = new Map<string, Uint8Array>();
  for (const [path, bytes] of ran) ranByName.set(path.split('/').pop()!, bytes);

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(`${dir}/${entry.name}`);
      else if (entry.name.endsWith('.js.map')) script(`${dir}/${entry.name}`);
    }
  };
  const script = (mapPath: string) => {
    const raw = readFileSync(mapPath, 'utf8');
    const map = JSON.parse(raw) as { sources: string[]; mappings: string };
    // A path under the repository, wherever the bundle was built.
    const files = map.sources.map((source) => {
      const path = resolve(dirname(mapPath), source);
      if (path.startsWith(repository)) return path.slice(repository.length);
      const from = path.search(/\/(apps|packages)\//);
      return from < 0 ? path : path.slice(from + 1);
    });
    if (!files.some(wanted)) return;

    const scriptPath = mapPath.slice(0, -'.map'.length);
    const bytes = ranByName.get(scriptPath.split('/').pop()!);
    let starts: number[] | undefined;
    if (bytes) {
      const text = readFileSync(scriptPath, 'utf8');
      starts = [0];
      for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
        starts.push(i + 1);
      }
    }
    for (const segment of segments(map.mappings)) {
      const file = files[segment.source];
      if (!file || !wanted(file)) continue;
      let entry = byFile.get(file);
      if (!entry) {
        entry = { lines: new Set(), covered: new Set(), loaded: false };
        byFile.set(file, entry);
      }
      entry.lines.add(segment.sourceLine);
      if (!bytes || !starts) continue;
      entry.loaded = true;
      if (bytes[starts[segment.line] + segment.column] === 1) {
        entry.covered.add(segment.sourceLine);
      }
    }
  };
  visit(dist);

  const result = new Map<string, FileLines>();
  for (const [file, entry] of byFile) {
    result.set(file, {
      lines: entry.lines.size,
      covered: entry.covered.size,
      loaded: entry.loaded,
    });
  }
  return result;
}
