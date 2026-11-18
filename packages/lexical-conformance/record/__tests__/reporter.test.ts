import { expect, test } from 'vitest';
import { caseName } from '../reporter';

test('duplicate titles keep declaration identities when results arrive out of order', () => {
  const declared = [
    { id: 'first', fullName: 'parameterized case' },
    { id: 'second', fullName: 'parameterized case' },
    { id: 'third', fullName: 'another case' },
  ];
  expect(caseName(declared[1], declared)).toBe('parameterized case [case 2]');
  expect(caseName(declared[0], declared)).toBe('parameterized case');
  expect(caseName(declared[2], declared)).toBe('another case');
});
