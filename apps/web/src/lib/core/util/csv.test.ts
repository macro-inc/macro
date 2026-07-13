import { describe, expect, test } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  test('parses a simple CSV with headers', () => {
    const res = parseCsv('a,b\n1,2\n3,4\n');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.headers).toEqual(['a', 'b']);
    expect(res.records).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  test('handles quoted commas and escaped quotes', () => {
    const res = parseCsv('a,b\n"hello, world","he said ""hi"""\n');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records).toEqual([{ a: 'hello, world', b: 'he said "hi"' }]);
  });

  test('handles newlines inside quotes', () => {
    const res = parseCsv('a,b\n"line1\nline2",x\n');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records).toEqual([{ a: 'line1\nline2', b: 'x' }]);
  });

  test('errors on unterminated quote', () => {
    const res = parseCsv('a\n"oops\n');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('unterminated');
  });
});
