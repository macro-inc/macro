import { expect, it } from 'vitest';
import { escapeCell } from './editor-behavior-inventory';

it('preserves JSX, union syntax and entity text as visible table evidence', () => {
  expect(escapeCell('<Editor mode="edit|comment"> &lt;\nnext')).toBe(
    '&lt;Editor mode="edit&#124;comment"&gt; &amp;lt; next'
  );
});
