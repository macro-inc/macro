import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import {
  readFixtureText,
  recordedFiles,
  removeRecordedFiles,
  writeRecordedFile,
} from '../files';

test('compressed recorder indexes retain exact text and logical ownership', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'lexical-gzip-index-'));
  const file = path.join(directory, 'index.json');
  const text = '[\n  {"id":"fixture/λ","file":null}\n]\n';
  try {
    writeRecordedFile(file, text);
    expect(gunzipSync(readFileSync(`${file}.gz`)).toString('utf8')).toBe(text);
    expect(readFixtureText(file)).toBe(text);
    expect(readFixtureText(`${file}.gz`)).toBe(text);
    expect(recordedFiles(directory)).toEqual(['index.json']);
    writeFileSync(file, text);
    expect(() => readFixtureText(file)).toThrow('Ambiguous fixture');
    expect(() => readFixtureText(`${file}.gz`)).toThrow('Ambiguous fixture');
    rmSync(file);
    writeFileSync(`${file}.gz`, 'corrupt gzip');
    expect(() => readFixtureText(file)).toThrow();
    removeRecordedFiles(directory);
    expect(recordedFiles(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('regenerating the recording preserves independent differential counterexamples', () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'lexical-recorded-files-')
  );
  try {
    mkdirSync(path.join(directory, 'upstream/lexical-core'), {
      recursive: true,
    });
    mkdirSync(path.join(directory, 'fuzz'));
    writeFileSync(path.join(directory, 'index.json'), '[]');
    writeFileSync(
      path.join(directory, 'upstream/lexical-core/case.json'),
      '{}'
    );
    writeFileSync(path.join(directory, 'fuzz/counterexample.json'), 'retained');
    expect(recordedFiles(directory)).toEqual([
      'index.json',
      'upstream/lexical-core/case.json',
    ]);
    removeRecordedFiles(directory);
    expect(recordedFiles(directory)).toEqual([]);
    expect(
      readFileSync(path.join(directory, 'fuzz/counterexample.json'), 'utf8')
    ).toBe('retained');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
