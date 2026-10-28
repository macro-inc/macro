import { describe, expect, it } from 'vitest';
import { evaluate } from './arith';

describe('field arithmetic', () => {
  it('evaluates expressions with precedence', () => {
    expect(evaluate('100')).toBe(100);
    expect(evaluate('100*2')).toBe(200);
    expect(evaluate('48/3+4')).toBe(20);
    expect(evaluate('2*(3+4)')).toBe(14);
    expect(evaluate('-5 + 2')).toBe(-3);
    expect(evaluate('1.5e2')).toBe(150);
  });

  it('rejects anything else', () => {
    expect(evaluate('')).toBeNull();
    expect(evaluate('abc')).toBeNull();
    expect(evaluate('2+')).toBeNull();
    expect(evaluate('1/0')).toBeNull();
    expect(evaluate('alert(1)')).toBeNull();
  });
});
