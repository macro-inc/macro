import { expect, it } from 'vitest';
import { localFields } from './local-fields';

it('preserves the entire source instead of guessing where an outgoing body begins', () => {
  const text = 'email Julia about the report that failed\nPlease investigate';
  expect(localFields(text, 'email')).toEqual({ body: text });
  expect(localFields(text, 'message')).toEqual({ body: text });
});

it('keeps a complete Markdown note and a structural first-line title', () => {
  const text = '# Research\n\n- First finding\n- Second finding';
  expect(localFields(text, 'note')).toEqual({ title: 'Research', body: text });
});
