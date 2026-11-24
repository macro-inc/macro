import { describe, expect, it } from 'vitest';
import { splitSearchOperators } from './search-operator-text';

describe('splitSearchOperators', () => {
  const isOperator = (token: string) => token === 'is:unread';

  it('marks the tokens a caller recognises and gives the text back unchanged', () => {
    const text = '  budget is:unread  q3 ';
    const parts = splitSearchOperators(text, isOperator);

    expect(parts).toEqual([
      { text: '  budget ', operator: false },
      { text: 'is:unread', operator: true },
      { text: '  q3 ', operator: false },
    ]);
    expect(parts.map((part) => part.text).join('')).toBe(text);
  });

  it('keeps text with no operator as one run', () => {
    expect(splitSearchOperators('quarterly budget', isOperator)).toEqual([
      { text: 'quarterly budget', operator: false },
    ]);
  });
});
