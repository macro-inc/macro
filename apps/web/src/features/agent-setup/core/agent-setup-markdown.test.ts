import { describe, expect, it } from 'vitest';
import { markdownParts } from './agent-setup-markdown';

describe('markdownParts', () => {
  it('finds links between text and keeps every other character', () => {
    expect(
      markdownParts('- [Docs](https://docs.test)\n- [SDK](https://sdk.test)\n')
    ).toEqual([
      { t: 'text', text: '- ' },
      { t: 'link', label: 'Docs', url: 'https://docs.test' },
      { t: 'text', text: '\n- ' },
      { t: 'link', label: 'SDK', url: 'https://sdk.test' },
      { t: 'text', text: '\n' },
    ]);
  });

  it('leaves code that only looks close to a link as text', () => {
    const code = 'const list = [a, b]; call(list);';

    expect(markdownParts(code)).toEqual([{ t: 'text', text: code }]);
  });
});
