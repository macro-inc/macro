import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { recordedFiles, removeRecordedFiles } from '../files';

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
