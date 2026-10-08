import { describe, expect, it } from 'vitest';
import { convertedColumnName } from './column-schema';

describe('converted column names', () => {
  it('names the new column after the original and the type it converts to', () => {
    expect(convertedColumnName('Score', 'Number', ['Name', 'Score'])).toBe(
      'Score (Number)'
    );
  });

  it('numbers the name from 2 while the table has it, ignoring case and spaces around', () => {
    expect(
      convertedColumnName('Score', 'Number', [
        'Score',
        ' score (number) ',
        'SCORE (NUMBER) 2',
      ])
    ).toBe('Score (Number) 3');
  });
});
