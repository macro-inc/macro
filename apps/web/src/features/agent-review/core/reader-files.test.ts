import { expect, it } from 'vitest';
import type { Chapter } from './model';
import { readerFiles } from './reader-files';
import type { ReviewEntry } from './source';

const files: ReviewEntry[] = [
  'src/b.ts',
  'README.md',
  'generated/a.json',
  'src/a.ts',
].map((path) => ({
  path,
  status: 'modified',
  added: 1,
  removed: 1,
  content: path,
}));
const chapter = (paths: string[]): Chapter => ({
  title: 'Change',
  description: '',
  note: '',
  paths,
  focus: { path: paths[0], side: 'new', line: 1 },
});
it('reads every repository file once, with folders before root files', () => {
  expect(readerFiles(files, [], false).map((file) => file.path)).toEqual([
    'generated/a.json',
    'src/a.ts',
    'src/b.ts',
    'README.md',
  ]);
});
it('continues across overlapping chapters into remaining files without duplicating paths', () => {
  const chapters = [
    chapter(['src/b.ts', 'missing.ts']),
    chapter(['src/b.ts', 'README.md']),
  ];
  expect(readerFiles(files, chapters, true).map((file) => file.path)).toEqual([
    'src/b.ts',
    'README.md',
    'generated/a.json',
    'src/a.ts',
  ]);
  expect(
    readerFiles(
      files.filter((file) => !file.path.startsWith('generated/')),
      chapters,
      true
    )
  ).toHaveLength(3);
});
