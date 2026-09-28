import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, Model } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  formulaCompletion,
  formulaFunctions,
  insertFunction,
} from './formula-completion';

beforeAll(() => {
  const require = createRequire(import.meta.url);
  initSync({
    module: readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')),
  });
});
function complete(text: string, cursor = text.length) {
  const model = new Model('Help', 'en', 'UTC', 'en');
  try {
    return formulaCompletion(
      text,
      model.getFormulaCompletion(
        0,
        1,
        1,
        text,
        Array.from(text.slice(0, cursor)).length
      )
    );
  } finally {
    model.free();
  }
}

describe('formula help using the actual IronCalc parser', () => {
  it('suggests common functions first, case-insensitively, including dotted names', () => {
    expect(complete('=s')).toMatchObject({ kind: 'list', from: 1 });
    expect(
      complete('=s')?.kind === 'list' &&
        (complete('=s') as { names: string[] }).names[0]
    ).toBe('SUM');
    expect(complete('=NORM.D')).toMatchObject({
      kind: 'list',
      names: ['NORM.DIST'],
    });
    expect(formulaFunctions.RAND).toBeUndefined();
    expect(formulaFunctions.HYPERLINK).toBeUndefined();
  });
  it('finds nested functions and the current argument without suggesting inside text', () => {
    expect(complete('=IF(A1>0,SU')).toMatchObject({ kind: 'list', from: 9 });
    expect(complete('=SUMIF(A1:A5,')).toEqual({
      kind: 'detail',
      name: 'SUMIF',
      argument: 1,
    });
    expect(complete('=IF(SUM(A1:A5)>0,')).toEqual({
      kind: 'detail',
      name: 'IF',
      argument: 1,
    });
    expect(complete('=SUM("S')).toBeUndefined();
    expect(complete('=A1')).toBeUndefined();
    expect(complete('=NOTAFUNCTION')).toBeUndefined();
  });
  it('preserves Unicode and suffixes when accepting in the middle of a formula', () => {
    const text = '=IF(TRUE,"😀",SU';
    const completion = complete(text);
    expect(completion?.kind).toBe('list');
    if (completion?.kind !== 'list') throw new Error('Expected names');
    expect(insertFunction(text, text.length, completion.from, 'SUM')).toEqual({
      text: '=IF(TRUE,"😀",SUM(',
      cursor: 18,
    });
    expect(insertFunction('=SUM(A1)+2', 3, 1, 'SUM')).toEqual({
      text: '=SUM(A1)+2',
      cursor: 5,
    });
    expect(insertFunction('=IF(A1,SU,0)', 9, 7, 'SUM')).toEqual({
      text: '=IF(A1,SUM(,0)',
      cursor: 11,
    });
  });
});
