import { describe, expect, it } from 'vitest';
import { buildPrompt } from './coder-prompt';

describe('buildPrompt', () => {
  it('embeds verbatim snippets as JSON and lists pending ones by brief', () => {
    const prompt = buildPrompt('do the thing', '<p id="a1">hi</p>', {
      exact: 'verbatim value',
      intro: {
        brief: 'two paragraphs, casual tone',
        promise: Promise.resolve('x'),
      },
    });
    expect(prompt).toContain('"exact": "verbatim value"');
    expect(prompt).toContain('`snippets.intro` -- two paragraphs, casual tone');
    // the promise itself must never be stringified into the prompt
    expect(prompt).not.toContain('{}');
    expect(prompt).not.toContain('Promise');
  });

  it('lists only the pending block when all snippets are pending', () => {
    const prompt = buildPrompt('task', 'ctx', {
      body: { brief: 'one paragraph', promise: Promise.resolve('x') },
    });
    expect(prompt).not.toContain('const snippets =');
    expect(prompt).toContain('`snippets.body` -- one paragraph');
  });

  it('omits both snippet blocks when none are given', () => {
    const prompt = buildPrompt('task', 'ctx');
    expect(prompt).not.toContain('snippets');
  });
});
