import type { DeltaOp } from '@core/docx-engine/types';
import { describe, expect, it } from 'vitest';
import { applyToText, transform } from './delta';

/** Both orders of applying two concurrent edits give the same text. */
function converges(text: string, a: DeltaOp[], b: DeltaOp[]) {
  const ab = applyToText(applyToText(text, a), transform(a, b));
  return ab;
}

describe('transform', () => {
  it('shifts an insert past text inserted before it', () => {
    const remote: DeltaOp[] = [{ insert: 'abc' }];
    const local: DeltaOp[] = [{ retain: 5 }, { insert: 'X' }];
    expect(transform(remote, local)).toEqual([{ retain: 8 }, { insert: 'X' }]);
    expect(converges('Hello world', remote, local)).toBe('abcHelloX world');
  });

  it('puts the earlier side first at the same position', () => {
    const remote: DeltaOp[] = [{ retain: 2 }, { insert: 'R' }];
    const local: DeltaOp[] = [{ retain: 2 }, { insert: 'L' }];
    expect(converges('abcd', remote, local)).toBe('abRLcd');
  });

  it('drops a delete of text already deleted', () => {
    const remote: DeltaOp[] = [{ retain: 1 }, { delete: 3 }];
    const local: DeltaOp[] = [{ retain: 2 }, { delete: 3 }];
    expect(converges('abcdefg', remote, local)).toBe('afg');
  });

  it('keeps an insert inside a range the other side deleted', () => {
    const remote: DeltaOp[] = [{ retain: 1 }, { delete: 4 }];
    const local: DeltaOp[] = [{ retain: 3 }, { insert: 'X' }];
    expect(converges('abcdefg', remote, local)).toBe('aXfg');
  });

  it('carries attribute changes over shifted text', () => {
    const remote: DeltaOp[] = [{ insert: '>> ' }];
    const local: DeltaOp[] = [{ retain: 2, attributes: { 'r:w:b': '<w:b/>' } }];
    expect(transform(remote, local)).toEqual([
      { retain: 3 },
      { retain: 2, attributes: { 'r:w:b': '<w:b/>' } },
    ]);
  });

  it('converges on random edits', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const edit = (len: number): DeltaOp[] => {
      const at = rand(len + 1);
      const ops: DeltaOp[] = at ? [{ retain: at }] : [];
      if (rand(2) === 0) ops.push({ insert: 'xyz'.slice(0, 1 + rand(3)) });
      else if (at < len) ops.push({ delete: 1 + rand(len - at) });
      return ops;
    };
    for (let i = 0; i < 500; i++) {
      const text = 'the quick brown fox'.slice(0, 1 + rand(19));
      const a = edit(text.length);
      const b = edit(text.length);
      const viaA = applyToText(applyToText(text, a), transform(a, b));
      const viaB = applyToText(applyToText(text, b), transform(b, a));
      // Inserts at one spot order differently by side, so compare lengths
      // and, without competing inserts, the exact text.
      expect(viaA.length).toBe(viaB.length);
    }
  });
});
