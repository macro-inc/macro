import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  countViolations,
  formatBaseline,
} from './check-floating-promises';

function diagnostic(filename: string, code = 'typescript(no-floating-promises)') {
  return {
    code,
    message: 'Promises must be awaited, add void operator to ignore.',
    filename,
    labels: [{ span: { line: 1, column: 1 } }],
  };
}

describe('countViolations', () => {
  it('counts floating promises per file and ignores other rules', () => {
    expect(
      countViolations([
        diagnostic('src/a.ts'),
        diagnostic('src/a.ts'),
        diagnostic('src/b.ts'),
        diagnostic('src/b.ts', 'eslint(complexity)'),
      ])
    ).toEqual({ 'src/a.ts': 2, 'src/b.ts': 1 });
  });
});

describe('compareToBaseline', () => {
  it('passes when every file matches its baseline', () => {
    expect(
      compareToBaseline({ 'src/a.ts': 2 }, { 'src/a.ts': 2 })
    ).toEqual({ increased: [], decreased: [] });
  });

  it('flags a file that gains violations, including a new file', () => {
    expect(
      compareToBaseline(
        { 'src/a.ts': 3, 'src/new.ts': 1 },
        { 'src/a.ts': 2 }
      ).increased
    ).toEqual([
      { file: 'src/a.ts', baseline: 2, current: 3 },
      { file: 'src/new.ts', baseline: 0, current: 1 },
    ]);
  });

  it('flags a file whose violations were fixed so the baseline gets lowered', () => {
    expect(
      compareToBaseline({ 'src/a.ts': 1 }, { 'src/a.ts': 2, 'src/b.ts': 1 })
        .decreased
    ).toEqual([
      { file: 'src/a.ts', baseline: 2, current: 1 },
      { file: 'src/b.ts', baseline: 1, current: 0 },
    ]);
  });
});

describe('formatBaseline', () => {
  it('writes files in sorted order with a trailing newline', () => {
    expect(formatBaseline({ 'src/b.ts': 1, 'src/a.ts': 2 })).toBe(
      '{\n  "src/a.ts": 2,\n  "src/b.ts": 1\n}\n'
    );
  });
});
